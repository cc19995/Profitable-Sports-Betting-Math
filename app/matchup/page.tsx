"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SnapshotLoader } from "../components/SnapshotLoader";
import { american, evPct, kickoffLabel, pct, pts } from "@/src/lib/format";
import { isLeague } from "@/src/lib/league";

function MatchupInner() {
  const params = useSearchParams();
  const leagueRaw = params.get("league") ?? "nfl";
  const id = params.get("id");
  const league = isLeague(leagueRaw) ? leagueRaw : "nfl";

  return (
    <SnapshotLoader>
      {(snapshot) => {
        const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
        const row = pack.board.find((item) => item.game.id === id);
        if (!row) {
          return (
            <div className="panel p-5">
              <p>Matchup not found on the current board.</p>
              <Link href="/" className="accent text-sm">Back to board</Link>
            </div>
          );
        }
        const { game, report } = row;
        return (
          <div className="space-y-5">
            <div>
              <Link href="/" className="text-xs mute hover:text-[var(--accent)]">← Board</Link>
              <h1 className="text-2xl font-semibold mt-1">
                {game.away.name} @ {game.home.name}
              </h1>
              <p className="mute text-sm">
                {kickoffLabel(game.kickoffIso)} · {game.venueName ?? "venue n/a"} · {game.market?.book ?? "no book"} ·{" "}
                {report.engine === "house-epa" ? "House EPA model" : "SRS fallback"}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="panel p-4">
                <div className="text-xs uppercase mute tracking-wider">Projected score</div>
                <div className="text-3xl font-semibold num mt-1">
                  {report.projection.awayScore.toFixed(1)}–{report.projection.homeScore.toFixed(1)}
                </div>
                <div className="text-sm mute mt-2">
                  Home win {pct(report.projection.winProbHome)} · Home cover {pct(report.projection.coverProbHome)} · Over {pct(report.projection.overProb)}
                </div>
              </div>
              <div className="panel p-4">
                <div className="text-xs uppercase mute tracking-wider">Model vs market</div>
                <div className="mt-2 text-sm space-y-1">
                  <div>Spread {pts(report.projection.margin)} vs {pts(game.market?.homeSpread)}</div>
                  <div>Total {report.projection.total.toFixed(1)} vs {game.market?.total ?? "—"}</div>
                  <div>ML {pct(report.projection.winProbHome)} vs {game.market?.homeMoneyline ? american(game.market.homeMoneyline) : "—"}</div>
                </div>
              </div>
              <div className="panel p-4">
                <div className="text-xs uppercase mute tracking-wider">Confidence {report.confidence.score}</div>
                <ul className="mt-2 text-sm mute space-y-1">
                  {report.confidence.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>

            {game.edge ? (
              <div className="panel p-4 text-sm space-y-3">
                <div className="text-xs uppercase mute tracking-wider">Weekly edge ingest</div>
                {game.edge.notes.length > 0 ? (
                  <div className="accent">{game.edge.notes.join(" · ")}</div>
                ) : (
                  <div className="mute">No material injury/weather/line-move flags on this game.</div>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs mute uppercase">Injuries</div>
                    <div className="mt-1">
                      {game.home.abbreviation}: QB {game.edge.scoreAdjustments.qbHome.toFixed(1)}, rest {game.edge.scoreAdjustments.injuryHome.toFixed(1)}
                    </div>
                    <div>
                      {game.away.abbreviation}: QB {game.edge.scoreAdjustments.qbAway.toFixed(1)}, rest {game.edge.scoreAdjustments.injuryAway.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs mute uppercase">Weather</div>
                    <div className="mt-1">{game.edge.weather.description}</div>
                    <div className="mute">Total trim {game.edge.weather.totalAdjustment.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-xs mute uppercase">Market tape</div>
                    <div className="mt-1">
                      Consensus {game.edge.market.consensusHomeSpread ?? "—"} / {game.edge.market.consensusTotal ?? "—"}
                    </div>
                    <div className="mute">
                      ESPN move {game.edge.market.espnSpreadMove ?? "—"} · {game.edge.market.books.length} books
                    </div>
                  </div>
                </div>
                {game.edge.news.length > 0 ? (
                  <ul className="mute space-y-1">
                    {game.edge.news.slice(0, 4).map((item) => (
                      <li key={item.headline}>{item.headline}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {report.signals.length > 0 ? (
              <div className="panel p-4 text-sm space-y-1">
                <div className="text-xs uppercase mute tracking-wider">Smart signals</div>
                {report.signals.map((signal) => (
                  <div key={signal.id} className={signal.kind === "caution" ? "warn" : "good"}>
                    {signal.kind === "caution" ? "Caution" : "Flag"} · {signal.label}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase mute tracking-wider">
                  <tr className="border-b border-[var(--line)]">
                    <th className="text-left px-3 py-2">Side</th>
                    <th className="text-right px-3 py-2">Odds</th>
                    <th className="text-right px-3 py-2">P</th>
                    <th className="text-right px-3 py-2">S</th>
                    <th className="text-right px-3 py-2">Fair S′</th>
                    <th className="text-right px-3 py-2">Juice</th>
                    <th className="text-right px-3 py-2">DTM</th>
                    <th className="text-right px-3 py-2">EV</th>
                    <th className="text-right px-3 py-2">¼ Kelly</th>
                  </tr>
                </thead>
                <tbody>
                  {report.priced.map((side) => (
                    <tr key={`${side.betType}-${side.side}`} className="border-t border-[var(--line)]">
                      <td className="px-3 py-2">
                        {side.label}{" "}
                        {side.plusEv ? <span className="good text-xs">+EV</span> : <span className="mute text-xs">no value</span>}
                      </td>
                      <td className="px-3 py-2 text-right num">{american(side.americanOdds)}</td>
                      <td className="px-3 py-2 text-right num">{pct(side.handicappedP)}</td>
                      <td className="px-3 py-2 text-right num">{pct(side.impliedS)}</td>
                      <td className="px-3 py-2 text-right num">{pct(side.fairS)}</td>
                      <td className="px-3 py-2 text-right num">{pct(side.juice)}</td>
                      <td className={`px-3 py-2 text-right num ${side.edge > 0 ? "good" : "bad"}`}>{pct(side.edge)}</td>
                      <td className={`px-3 py-2 text-right num ${side.plusEv ? "good" : "bad"}`}>{evPct(side.evPerUnit)}</td>
                      <td className="px-3 py-2 text-right num">{pct(Math.max(0, side.kellyQuarter), 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel overflow-x-auto">
              <div className="px-3 py-2 text-xs uppercase mute tracking-wider">Statistics that matter on this game</div>
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase mute">
                  <tr className="border-y border-[var(--line)]">
                    <th className="text-left px-3 py-2">Stat</th>
                    <th className="text-right px-3 py-2">{game.home.abbreviation}</th>
                    <th className="text-right px-3 py-2">{game.away.abbreviation}</th>
                    <th className="text-left px-3 py-2">Why it matters</th>
                  </tr>
                </thead>
                <tbody>
                  {report.diagnostics.map((row) => (
                    <tr key={row.key} className="border-t border-[var(--line)] align-top">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2 text-right num">{row.homeValue}</td>
                      <td className="px-3 py-2 text-right num">{row.awayValue}</td>
                      <td className="px-3 py-2 mute">
                        <div>{row.note}</div>
                        <div className="text-xs mt-1">{row.bettingRelevance}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </SnapshotLoader>
  );
}

export default function MatchupPage() {
  return (
    <Suspense fallback={<div className="mute">Loading matchup…</div>}>
      <MatchupInner />
    </Suspense>
  );
}
