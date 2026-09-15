#!/usr/bin/env python3
"""DraftKings NFL Classic lineup optimizer.

Builds a legal Classic roster that maximizes expected DraftKings points
subject to a salary cap. The default cap is $55,000 (user-specified);
official DraftKings Classic contests use $50,000.

Expected value vs the salary market
-----------------------------------
DraftKings prices players so that cash-game lineups typically need about
2.5 fantasy points per $1,000 of salary. A player is treated as +EV when:

    projection  >  salary / 1000 * 2.5

That is the same calibration idea used in this repo's moneyline math:
only roster a player when the handicapped mean exceeds the price implied
by the market. The optimizer maximizes total projection (cash-game /
highest-probability-of-profit objective) and reports each player's edge
versus that salary-implied baseline.

Stacking
--------
A small correlation bonus is added for a QB with one or two teammates
and an optional opponent bring-back. That does not replace the mean
projection; it only breaks ties toward correlated game stacks in the
highest-total remaining games.
"""

from __future__ import annotations

import argparse
import csv
import itertools
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

ROSTER_SLOTS = ("QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST")
FLEX_POSITIONS = frozenset({"RB", "WR", "TE"})
POINTS_PER_1K = 2.5
DEFAULT_CAP = 55_000
OFFICIAL_DK_CAP = 50_000
DATA_PATH = Path(__file__).with_name("week2_2026_players.csv")


@dataclass(frozen=True)
class Player:
    name: str
    pos: str
    team: str
    opp: str
    week1_salary: int | None
    salary: int
    salary_source: str
    proj: float
    notes: str

    @property
    def implied(self) -> float:
        return self.salary / 1000.0 * POINTS_PER_1K

    @property
    def edge(self) -> float:
        return self.proj - self.implied

    @property
    def value(self) -> float:
        return self.proj / (self.salary / 1000.0)


def parse_optional_int(raw: str) -> int | None:
    text = raw.strip()
    if not text:
        return None
    return int(text)


def load_players(path: Path) -> list[Player]:
    if not path.is_file():
        raise FileNotFoundError(f"Player pool not found: {path}")

    players: list[Player] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {
            "player",
            "pos",
            "team",
            "opp",
            "week1_salary",
            "week2_salary",
            "salary_source",
            "proj",
            "notes",
        }
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise ValueError("Player CSV is missing required columns")

        for row in reader:
            name = row["player"].strip()
            pos = row["pos"].strip().upper()
            team = row["team"].strip().upper()
            opp = row["opp"].strip().upper()
            source = row["salary_source"].strip()
            notes = row["notes"].strip()
            salary = int(row["week2_salary"])
            proj = float(row["proj"])
            if not name:
                raise ValueError("Player name is required")
            if pos not in {"QB", "RB", "WR", "TE", "DST"}:
                raise ValueError(f"Invalid position for {name}: {pos}")
            if salary < 2000:
                raise ValueError(f"Salary below DraftKings minimum for {name}")
            if proj <= 0:
                raise ValueError(f"Projection must be positive for {name}")
            players.append(
                Player(
                    name=name,
                    pos=pos,
                    team=team,
                    opp=opp,
                    week1_salary=parse_optional_int(row["week1_salary"]),
                    salary=salary,
                    salary_source=source,
                    proj=proj,
                    notes=notes,
                )
            )
    if not players:
        raise ValueError("Player pool is empty")
    return players


def by_pos(players: Sequence[Player], pos: str) -> list[Player]:
    return [player for player in players if player.pos == pos]


def stack_bonus(lineup: Sequence[Player]) -> float:
    qb = next(player for player in lineup if player.pos == "QB")
    teammates = [
        player
        for player in lineup
        if player is not qb and player.pos != "DST" and player.team == qb.team
    ]
    bring_backs = [
        player
        for player in lineup
        if player.pos != "DST" and player.team == qb.opp
    ]
    bonus = 0.0
    if len(teammates) >= 1:
        bonus += 1.2
    if len(teammates) >= 2:
        bonus += 0.8
    if bring_backs:
        bonus += 0.6
    return bonus


def lineup_projection(lineup: Sequence[Player]) -> float:
    return sum(player.proj for player in lineup) + stack_bonus(lineup)


def remaining_flex_candidates(
    rbs: Iterable[Player],
    wrs: Iterable[Player],
    tes: Iterable[Player],
    used: set[Player],
) -> list[Player]:
    candidates = []
    for player in itertools.chain(rbs, wrs, tes):
        if player not in used:
            candidates.append(player)
    candidates.sort(key=lambda player: player.proj, reverse=True)
    return candidates


def best_flex(
    candidates: Sequence[Player], remaining_salary: int
) -> Player | None:
    for player in candidates:
        if player.salary <= remaining_salary:
            return player
    return None


def optimize(
    players: Sequence[Player],
    cap: int,
    qb_limit: int = 8,
    rb_limit: int = 12,
    wr_limit: int = 14,
    te_limit: int = 6,
    dst_limit: int = 5,
) -> list[Player]:
    if cap < 9 * 2000:
        raise ValueError("Salary cap cannot field a legal DraftKings roster")

    qbs = sorted(by_pos(players, "QB"), key=lambda p: p.proj, reverse=True)[:qb_limit]
    rbs = sorted(by_pos(players, "RB"), key=lambda p: p.proj, reverse=True)[:rb_limit]
    wrs = sorted(by_pos(players, "WR"), key=lambda p: p.proj, reverse=True)[:wr_limit]
    tes = sorted(by_pos(players, "TE"), key=lambda p: (p.edge, p.proj), reverse=True)[
        :te_limit
    ]
    dsts = sorted(by_pos(players, "DST"), key=lambda p: p.proj, reverse=True)[
        :dst_limit
    ]

    if not (qbs and rbs and wrs and tes and dsts):
        raise ValueError("Player pool is missing a required position")

    cheapest_rb = min(player.salary for player in rbs)
    cheapest_wr = min(player.salary for player in wrs)
    cheapest_te = min(player.salary for player in tes)
    cheapest_dst = min(player.salary for player in dsts)
    cheapest_flex = min(cheapest_rb, cheapest_wr, cheapest_te)

    best_lineup: list[Player] | None = None
    best_score = float("-inf")

    for qb in qbs:
        for te in tes:
            for dst in dsts:
                base = qb.salary + te.salary + dst.salary
                if base + 2 * cheapest_rb + 3 * cheapest_wr + cheapest_flex > cap:
                    continue
                for rb1, rb2 in itertools.combinations(rbs, 2):
                    after_rbs = base + rb1.salary + rb2.salary
                    if after_rbs + 3 * cheapest_wr + cheapest_flex > cap:
                        continue
                    used_core = {qb, te, dst, rb1, rb2}
                    for wr_combo in itertools.combinations(wrs, 3):
                        wr_salary = sum(player.salary for player in wr_combo)
                        spent = after_rbs + wr_salary
                        leftover = cap - spent
                        if leftover < cheapest_flex:
                            continue
                        used = used_core | set(wr_combo)
                        flex = best_flex(
                            remaining_flex_candidates(rbs, wrs, tes, used),
                            leftover,
                        )
                        if flex is None:
                            continue
                        lineup = [qb, rb1, rb2, wr_combo[0], wr_combo[1], wr_combo[2], te, flex, dst]
                        score = lineup_projection(lineup)
                        if score > best_score:
                            best_score = score
                            best_lineup = lineup

    if best_lineup is None:
        raise RuntimeError(f"No legal lineup found under ${cap:,}")
    return best_lineup


def format_lineup(lineup: Sequence[Player], cap: int) -> str:
    slots = list(ROSTER_SLOTS)
    ordered: list[tuple[str, Player]] = []
    remaining = list(lineup)
    for slot in slots[:-2]:
        match = next(player for player in remaining if player.pos == slot)
        remaining.remove(match)
        ordered.append((slot, match))
    flex = next(player for player in remaining if player.pos in FLEX_POSITIONS)
    remaining.remove(flex)
    dst = remaining[0]
    ordered.append(("FLEX", flex))
    ordered.append(("DST", dst))

    salary = sum(player.salary for player in lineup)
    proj = sum(player.proj for player in lineup)
    bonus = stack_bonus(lineup)
    lines = [
        f"DraftKings Classic lineup  |  cap ${cap:,}  |  spent ${salary:,}  |  leftover ${cap - salary:,}",
        f"Projected DK points: {proj:.1f}  |  stack bonus: {bonus:.1f}  |  objective: {proj + bonus:.1f}",
        "",
        f"{'Slot':<5} {'Player':<24} {'Pos':<4} {'Tm':<4} {'Opp':<4} {'Salary':>7} {'Proj':>6} {'Impl':>6} {'Edge':>6} {'Val':>5}",
        "-" * 88,
    ]
    for slot, player in ordered:
        lines.append(
            f"{slot:<5} {player.name:<24} {player.pos:<4} {player.team:<4} {player.opp:<4} "
            f"${player.salary:>6,} {player.proj:>6.1f} {player.implied:>6.1f} {player.edge:>+6.1f} {player.value:>5.2f}"
        )
    lines.append("-" * 88)
    plus_ev = sum(1 for player in lineup if player.edge > 0)
    lines.append(
        f"{plus_ev}/9 players project above the 2.5x salary baseline  |  "
        f"mean edge {sum(p.edge for p in lineup) / 9:+.2f} pts"
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize a DraftKings NFL Classic lineup")
    parser.add_argument("--cap", type=int, default=DEFAULT_CAP, help="Salary cap in dollars")
    parser.add_argument("--data", type=Path, default=DATA_PATH, help="Player CSV path")
    parser.add_argument(
        "--also-official",
        action="store_true",
        help="Also print a $50,000 official-cap lineup",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    players = load_players(args.data)
    lineup = optimize(players, args.cap)
    print(format_lineup(lineup, args.cap))
    if args.also_official and args.cap != OFFICIAL_DK_CAP:
        print()
        print("Official DraftKings Classic cap ($50,000) for comparison:")
        print(format_lineup(optimize(players, OFFICIAL_DK_CAP), OFFICIAL_DK_CAP))


if __name__ == "__main__":
    main()
