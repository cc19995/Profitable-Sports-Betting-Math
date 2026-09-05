"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ModelSnapshot } from "@/src/data/snapshot";
import type { League } from "@/src/lib/types";
import { collectBestBets, filterBoardByDate } from "@/src/lib/picks";
import { american, evPct, kickoffLabel, pct, pts, snapshotClockLabel } from "@/src/lib/format";
import { DeskFilters } from "./DeskFilters";

export function BestBetsView({ snapshot }: { snapshot: ModelSnapshot }) {
  const [league, setLeague] = useState<League>("nfl");
  const [dateKey, setDateKey] = useState("all");
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const picks = useMemo(
    () => collectBestBets(filterBoardByDate(pack.board, dateKey), 12),
    [pack.board, dateKey],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Best bets</h1>
          <p className="mute text-sm max-w-3xl">
            One recommended single per game, ranked by trust-adjusted quality — not raw EV.
            Flashy prices that disagree wildly with the market, huge-dog moneylines, and
            thin-sample NCAAF sides are filtered out. Still a worksheet, not a closer.
          </p>
        </div>
        <div className="text-right text-xs mute">
          <div>Snapshot {snapshotClockLabel(snapshot.generatedAt)}</div>
          <div>
            {pack.completedCount} completed games in ratings · {picks.length} singles
            {pack.backtest
              ? ` · holdout ${pack.backtest.n} bets, ROI ${(pack.backtest.roi * 100).toFixed(1)}%`
              : ""}
          </div>
        </div>
      </div>

      <DeskFilters
        snapshot={snapshot}
        league={league}
        dateKey={dateKey}
        onLeagueChange={setLeague}
        onDateChange={setDateKey}
      />

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider mute">
            <tr className="border-b border-[var(--line)]">
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">Matchup</th>
              <th className="text-left px-3 py-2">Kick</th>
              <th className="text-left px-3 py-2">Best bet</th>
              <th className="text-right px-3 py-2">P / S</th>
              <th className="text-right px-3 py-2">Edge</th>
              <th className="text-right px-3 py-2">EV</th>
              <th className="text-right px-3 py-2">¼ Kelly</th>
              <th className="text-right px-3 py-2">Spread Δ</th>
              <th className="text-right px-3 py-2">Conf</th>
              <th className="text-right px-3 py-2">Quality</th>
            </tr>
          </thead>
          <tbody>
            {picks.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 mute">
                  {pack.board.length === 0 ? (
                    <>
                      No games on this board. Run <code>npm run refresh</code> to pull ESPN /
                      nflverse and rebuild ratings.
                    </>
                  ) : (
                    "No singles clear the trust filter on this slate. That is intentional — raw +EV is not enough."
                  )}
                </td>
              </tr>
            ) : (
              picks.map((pick, index) => {
                const spreadGap =
                  pick.marketSpread !== undefined ? pick.modelMargin + pick.marketSpread : undefined;
                return (
                  <tr key={`${pick.gameId}:${pick.pick.betType}:${pick.pick.side}`} className="border-t border-[var(--line)] hover:bg-[var(--panel-2)]">
                    <td className="px-3 py-2 mute">{index + 1}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/matchup?league=${league}&id=${encodeURIComponent(pick.gameId)}`}
                        className="hover:text-[var(--accent)]"
                      >
                        <div className="font-medium">{pick.matchup}</div>
                        <div className="mute text-xs">
                          {pick.awayName} at {pick.homeName}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 mute text-xs">{kickoffLabel(pick.kickoffIso)}</td>
                    <td className="px-3 py-2">
                      <div className="good font-medium">
                        {pick.pick.label} {american(pick.pick.americanOdds)}
                      </div>
                      <div className="mute text-xs">{pick.pick.betType}</div>
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {pct(pick.pick.handicappedP)} / {pct(pick.pick.impliedS)}
                    </td>
                    <td className="px-3 py-2 text-right num">{pct(pick.pick.edge)}</td>
                    <td className="px-3 py-2 text-right num good">{evPct(pick.pick.evPerUnit)}</td>
                    <td className="px-3 py-2 text-right num">{pct(pick.pick.kellyQuarter, 2)}</td>
                    <td className="px-3 py-2 text-right num">{pts(spreadGap)}</td>
                    <td className="px-3 py-2 text-right num">{pick.confidence}</td>
                    <td className="px-3 py-2 text-right num accent">{pick.quality.toFixed(2)}</td>
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
