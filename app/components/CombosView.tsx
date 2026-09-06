"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ModelSnapshot } from "@/src/data/snapshot";
import type { League } from "@/src/lib/types";
import { collectParlayCombos, filterBoardByDate } from "@/src/lib/picks";
import { american, evPct, kickoffLabel, pct, snapshotClockLabel } from "@/src/lib/format";
import { DeskFilters } from "./DeskFilters";

export function CombosView({ snapshot }: { snapshot: ModelSnapshot }) {
  const [league, setLeague] = useState<League>("ncaaf");
  const [dateKey, setDateKey] = useState("all");
  const [sameDateOnly, setSameDateOnly] = useState(true);
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const combos = useMemo(
    () =>
      collectParlayCombos(filterBoardByDate(pack.board, dateKey), {
        maxPool: 8,
        maxCombos: 12,
        sameDateOnly,
      }),
    [pack.board, dateKey, sameDateOnly],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Parlay combos</h1>
          <p className="mute text-sm max-w-3xl">
            Auto-built 2- and 3-leg tickets from the NCAAF Best Bet pool. NFL is sat.
            No two legs from the same game. Ranked by trust-adjusted parlay quality, not
            the juiciest raw EV. The math assumes independence — do not add a correlated
            same-game number by hand.
            Use the{" "}
            <Link href="/parlay" className="accent">
              manual builder
            </Link>{" "}
            if you want to force a ticket.
          </p>
        </div>
        <div className="text-right text-xs mute">
          <div>Snapshot {snapshotClockLabel(snapshot.generatedAt)}</div>
          <div>
            {combos.length} combo{combos.length === 1 ? "" : "s"}
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
        extra={
          <label className="ml-3 text-sm mute flex items-center gap-2">
            <input
              type="checkbox"
              checked={sameDateOnly}
              onChange={(event) => setSameDateOnly(event.target.checked)}
            />
            Same kickoff date only
          </label>
        }
      />

      {combos.length === 0 ? (
        <div className="panel p-5 mute text-sm">
          {league === "nfl"
            ? "NFL is sat. Combos are only built from the NCAA Football Best Bet pool."
            : "Not enough profit-filter singles on this slate to build a +EV combo. Open Best Bets first — parlays are only assembled from that pool."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {combos.map((combo, index) => (
            <article key={combo.id} className="panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider mute">
                    {combo.legs.length}-leg · #{index + 1}
                    {combo.sameDate ? " · same day" : " · mixed dates"}
                  </div>
                  <div className="text-lg font-semibold">
                    {american(combo.combinedAmerican)}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="good">{evPct(combo.evPerUnit)} EV</div>
                  <div className="mute text-xs">¼ Kelly {pct(combo.kellyQuarter, 2)}</div>
                </div>
              </div>
              <div className="text-xs mute">
                Joint P {pct(combo.modelProb, 2)} · joint S {pct(combo.impliedProb, 2)}
                {combo.compounds ? " · ROI compounds vs first single" : ""}
              </div>
              <ul className="space-y-2 text-sm">
                {combo.legs.map((leg) => (
                  <li key={`${leg.gameId}:${leg.pick.side}:${leg.pick.betType}`}>
                    <Link
                      href={`/matchup?league=${league}&id=${encodeURIComponent(leg.gameId)}`}
                      className="hover:text-[var(--accent)]"
                    >
                      <div className="font-medium">
                        {leg.matchup} · {leg.pick.label} {american(leg.pick.americanOdds)}
                      </div>
                      <div className="mute text-xs">
                        {kickoffLabel(leg.kickoffIso)} · P {pct(leg.pick.handicappedP)} / S{" "}
                        {pct(leg.pick.impliedS)} · EV {evPct(leg.pick.evPerUnit)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {combo.warning ? <div className="warn text-xs">{combo.warning}</div> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
