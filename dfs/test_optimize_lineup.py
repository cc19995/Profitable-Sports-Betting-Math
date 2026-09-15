#!/usr/bin/env python3
"""Regression tests for the DraftKings Classic optimizer."""

from __future__ import annotations

import unittest
from pathlib import Path

from optimize_lineup import (
    OFFICIAL_DK_CAP,
    POINTS_PER_1K,
    Player,
    format_lineup,
    load_players,
    lineup_projection,
    optimize,
    stack_bonus,
)

DATA = Path(__file__).with_name("week2_2026_players.csv")


class PlayerPoolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.players = load_players(DATA)

    def test_pool_has_all_positions(self) -> None:
        positions = {player.pos for player in self.players}
        self.assertEqual(positions, {"QB", "RB", "WR", "TE", "DST"})

    def test_salaries_are_legal(self) -> None:
        for player in self.players:
            self.assertGreaterEqual(player.salary, 2000)
            self.assertEqual(player.salary % 100, 0)

    def test_implied_points_use_cash_baseline(self) -> None:
        henry = next(player for player in self.players if player.name == "Derrick Henry")
        self.assertAlmostEqual(henry.implied, henry.salary / 1000 * POINTS_PER_1K)


class OptimizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.players = load_players(DATA)

    def _assert_legal(self, lineup: list[Player], cap: int) -> None:
        positions = [player.pos for player in lineup]
        self.assertEqual(len(lineup), 9)
        self.assertEqual(positions.count("QB"), 1)
        self.assertEqual(positions.count("DST"), 1)
        self.assertGreaterEqual(positions.count("RB"), 2)
        self.assertGreaterEqual(positions.count("WR"), 3)
        self.assertGreaterEqual(positions.count("TE"), 1)
        self.assertLessEqual(sum(player.salary for player in lineup), cap)
        names = [player.name for player in lineup]
        self.assertEqual(len(names), len(set(names)))

    def _fast_kwargs(self) -> dict[str, int]:
        # Truncated pool keeps tests fast; full search is used by the CLI.
        return {
            "qb_limit": 5,
            "rb_limit": 8,
            "wr_limit": 10,
            "te_limit": 4,
            "dst_limit": 3,
        }

    def test_fifty_five_k_lineup_is_legal(self) -> None:
        lineup = optimize(self.players, 55_000, **self._fast_kwargs())
        self._assert_legal(lineup, 55_000)
        self.assertGreater(sum(player.proj for player in lineup), 120)

    def test_official_cap_lineup_is_legal(self) -> None:
        lineup = optimize(self.players, OFFICIAL_DK_CAP, **self._fast_kwargs())
        self._assert_legal(lineup, OFFICIAL_DK_CAP)

    def test_higher_cap_is_not_worse(self) -> None:
        limits = self._fast_kwargs()
        small = optimize(self.players, OFFICIAL_DK_CAP, **limits)
        large = optimize(self.players, 55_000, **limits)
        self.assertGreaterEqual(lineup_projection(large), lineup_projection(small) - 1e-9)

    def test_stack_bonus_rewards_qb_with_teammate(self) -> None:
        qb = Player("QB A", "QB", "CHI", "MIN", 6300, 6900, "t", 24.0, "")
        wr = Player("WR A", "WR", "CHI", "MIN", 5500, 5500, "t", 12.0, "")
        rb = Player("RB A", "RB", "BAL", "NO", 7400, 7400, "t", 22.0, "")
        stacked = [qb, wr, rb]
        unstacked = [
            qb,
            Player("WR B", "WR", "DAL", "WAS", 7200, 7200, "t", 12.0, ""),
            rb,
        ]
        self.assertGreater(stack_bonus(stacked), stack_bonus(unstacked))

    def test_format_lineup_includes_cap(self) -> None:
        lineup = optimize(self.players, 55_000, **self._fast_kwargs())
        text = format_lineup(lineup, 55_000)
        self.assertIn("$55,000", text)
        self.assertIn("Projected DK points", text)


if __name__ == "__main__":
    unittest.main()
