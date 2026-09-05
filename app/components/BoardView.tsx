"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { League } from "@/src/lib/types";
import type { ModelSnapshot } from "@/src/data/snapshot";
import { american, evPct, kickoffDateKey, kickoffDateLabel, kickoffLabel, pct, pts, snapshotClockLabel } from "@/src/lib/format";

export function BoardView({ snapshot }: { snapshot: ModelSnapshot }) {
  const [league, setLeague] = useState<League>("nfl");
  const [plusOnly, setPlusOnly] = useState(false);
  const [dateKey, setDateKey] = useState("all");
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const dates = useMemo(() => {
    const labels = new Map<string, string>();
    for (const row of pack.board) {
      const key = kickoffDateKey(row.game.kickoffIso);
      if (key && !labels.has(key)) {
        labels.set(key, kickoffDateLabel(row.game.kickoffIso));
      }
    }
    return [...labels.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [pack.board]);
  const rows = useMemo(() => {
    return pack.board.filter((row) => {
      if (plusOnly && !row.bestBet) {
        return false;
      }
      if (dateKey === "all") {
        return true;
      }
      return kickoffDateKey(row.game.kickoffIso) === dateKey;
    });
  }, [pack.board, plusOnly, dateKey]);
  const selectedDateExists = dateKey === "all" || dates.some(([key]) => key === dateKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Matchup board</h1>
          <p className="mute text-sm max-w-3xl">
            Recommended sides require P &gt; S after juice, a real projection gap
            (about 2.5 pts on the spread or 3.5 on the total), and the same trust
            filter as Best Bet. Raw-EV moneylines that fight the market are not
            the board pick. Prices are the ESPN/DraftKings (or nflverse close)
            number on the snapshot, not a Hard Rock shop.
          </p>
        </div>
        <div className="text-right text-xs mute">
          <div>Snapshot {snapshotClockLabel(snapshot.generatedAt)}</div>
          <div>
            {pack.completedCount} completed games in ratings · {pack.upcomingCount} priced
            {pack.backtest
              ? ` · holdout ${pack.backtest.n} bets, ROI ${(pack.backtest.roi * 100).toFixed(1)}%`
              : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {(["nfl", "ncaaf"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setLeague(value);
              if (dateKey !== "all") {
                const nextPack = value === "nfl" ? snapshot.nfl : snapshot.ncaaf;
                const stillExists = nextPack.board.some((row) => kickoffDateKey(row.game.kickoffIso) === dateKey);
                if (!stillExists) {
                  setDateKey("all");
                }
              }
            }}
            className={`px-3 py-1.5 text-sm border ${league === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
          >
            {value === "nfl" ? "NFL" : "NCAA Football"}
          </button>
        ))}
        <label className="ml-3 text-sm mute flex items-center gap-2">
          <input type="checkbox" checked={plusOnly} onChange={(e) => setPlusOnly(e.target.checked)} />
          +EV only
        </label>
        <label className="ml-3 text-sm mute flex items-center gap-2">
          Date
          <input
            type="date"
            value={dateKey === "all" ? "" : dateKey}
            min={dates[0]?.[0]}
            max={dates[dates.length - 1]?.[0]}
            onChange={(event) => setDateKey(event.target.value || "all")}
            className="bg-[var(--bg)] border border-[var(--line)] px-2 py-1 text-[var(--ink)]"
          />
        </label>
        <button
          type="button"
          onClick={() => setDateKey("all")}
          className={`px-3 py-1.5 text-sm border ${dateKey === "all" ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
        >
          All dates
        </button>
        {dates.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setDateKey(key)}
            className={`px-3 py-1.5 text-sm border ${dateKey === key ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs mute">
          {rows.length} game{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider mute">
            <tr className="border-b border-[var(--line)]">
              <th className="text-left px-3 py-2">Matchup</th>
              <th className="text-left px-3 py-2">Kick</th>
              <th className="text-right px-3 py-2">Model</th>
              <th className="text-right px-3 py-2">Spread Δ</th>
              <th className="text-right px-3 py-2">Total Δ</th>
              <th className="text-left px-3 py-2">Best price</th>
              <th className="text-right px-3 py-2">P / S</th>
              <th className="text-right px-3 py-2">EV</th>
              <th className="text-right px-3 py-2">¼ Kelly</th>
              <th className="text-right px-3 py-2">Conf</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 mute">
                  {pack.board.length === 0
                    ? <>No games on this board. Run <code>npm run refresh</code> to pull ESPN / nflverse and rebuild ratings.</>
                    : !selectedDateExists
                      ? "No games on the selected date for this league."
                      : "No games match the current filters."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const best = row.bestBet;
                const spreadGap =
                  row.game.market?.homeSpread !== undefined
                    ? row.report.projection.margin + row.game.market.homeSpread
                    : undefined;
                const totalGap =
                  row.game.market?.total !== undefined
                    ? row.report.projection.total - row.game.market.total
                    : undefined;
                return (
                  <tr key={row.game.id} className="border-t border-[var(--line)] hover:bg-[var(--panel-2)]">
                    <td className="px-3 py-2">
                      <Link href={`/matchup?league=${league}&id=${encodeURIComponent(row.game.id)}`} className="hover:text-[var(--accent)]">
                        <div className="font-medium">
                          {row.game.away.abbreviation} @ {row.game.home.abbreviation}
                        </div>
                        <div className="mute text-xs">
                          {row.game.away.name} at {row.game.home.name}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 mute text-xs">{kickoffLabel(row.game.kickoffIso)}</td>
                    <td className="px-3 py-2 text-right num">
                      {row.report.projection.awayScore.toFixed(1)}–{row.report.projection.homeScore.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      <div>{pts(row.report.projection.margin)} vs {pts(row.game.market?.homeSpread)}</div>
                      <div className={spreadGap !== undefined && Math.abs(spreadGap) >= 2.5 ? "accent" : "mute"}>
                        {pts(spreadGap)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      <div>{row.report.projection.total.toFixed(1)} vs {row.game.market?.total ?? "—"}</div>
                      <div className={totalGap !== undefined && Math.abs(totalGap) >= 3 ? "accent" : "mute"}>
                        {pts(totalGap)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {best ? (
                        <div>
                          <div className="good font-medium">{best.label} {american(best.americanOdds)}</div>
                          <div className="mute text-xs">{best.betType}</div>
                        </div>
                      ) : (
                        <span className="mute">
                          {row.report.priced.some((side) => side.plusEv) ? "no trusted side" : "no +EV side"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {best ? `${pct(best.handicappedP)} / ${pct(best.impliedS)}` : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right num ${best && best.evPerUnit > 0 ? "good" : "mute"}`}>
                      {evPct(best?.evPerUnit)}
                    </td>
                    <td className="px-3 py-2 text-right num">{best ? pct(best.kellyQuarter, 2) : "—"}</td>
                    <td className="px-3 py-2 text-right num">{row.report.confidence.score}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
