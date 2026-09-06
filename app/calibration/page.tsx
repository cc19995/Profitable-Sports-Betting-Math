"use client";

import { SnapshotLoader } from "../components/SnapshotLoader";
import { statsThatMatter } from "@/src/lib/features";
import { evPct, pct } from "@/src/lib/format";

export default function CalibrationPage() {
  const stats = statsThatMatter();
  return (
    <SnapshotLoader>
      {(snapshot) => {
        const tests = [
          { label: "NFL walk-forward", summary: snapshot.nfl.backtest },
          { label: "NCAAF walk-forward", summary: snapshot.ncaaf.backtest },
        ];
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Calibration & holdout</h1>
              <p className="mute text-sm max-w-3xl">
                Calibration means if the model says 30%, the event happens 30% of the time. The
                walk-forward below fits ratings on prior games only, then prices the next week
                against closing-style lines. Both leagues use the same profit rule: no moneylines,
                aligned spreads and totals only. The live desk only offers NCAAF. NFL stay-out is
                because that same rule lost money in 2024 and 2025 holdouts — those numbers stay
                on this page so the sit is auditable, not hidden. NCAAF holdout is the prior
                completed season vs ESPN BET closes.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {tests.map((test) => (
                <div key={test.label} className="panel p-4 text-sm space-y-2">
                  <div className="font-medium">{test.label}</div>
                  {test.summary ? (
                    <>
                      <div className="mute text-xs">
                        {test.summary.holdoutSeason ? `Holdout ${test.summary.holdoutSeason}` : "Holdout season inferred"}
                        {test.summary.pickRule ? ` · ${test.summary.pickRule}` : ""}
                      </div>
                      <div>Bets {test.summary.n} · wins {test.summary.wins} ({pct(test.summary.empiricalP)})</div>
                      <div>Average S {pct(test.summary.avgS)} · units {test.summary.units.toFixed(2)} · ROI {evPct(test.summary.roi)}</div>
                      <div>Max drawdown {test.summary.maxDrawdown.toFixed(2)} · Brier {test.summary.brier.toFixed(4)}</div>
                    </>
                  ) : (
                    <div className="mute">Not enough priced holdout bets in this snapshot.</div>
                  )}
                </div>
              ))}
            </div>
            <div className="panel overflow-x-auto">
              <div className="px-3 py-2 text-xs uppercase mute tracking-wider">What actually matters, and overfitting risk</div>
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase mute">
                  <tr className="border-y border-[var(--line)]">
                    <th className="text-left px-3 py-2">Stat</th>
                    <th className="text-left px-3 py-2">Why</th>
                    <th className="text-left px-3 py-2">How used</th>
                    <th className="text-left px-3 py-2">Overfit</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={row.stat} className="border-t border-[var(--line)] align-top">
                      <td className="px-3 py-2">{row.stat}</td>
                      <td className="px-3 py-2 mute">{row.why}</td>
                      <td className="px-3 py-2 mute">{row.howUsed}</td>
                      <td className="px-3 py-2">{row.overfitRisk}</td>
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
