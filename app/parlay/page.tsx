"use client";

import { useMemo, useState } from "react";
import { SnapshotLoader } from "../components/SnapshotLoader";
import type { ModelSnapshot } from "@/src/data/snapshot";
import type { ParlayEvaluation, PricedSide } from "@/src/lib/types";
import { evPct, pct } from "@/src/lib/format";

function ParlayBuilder({ snapshot }: { snapshot: ModelSnapshot }) {
  const [selected, setSelected] = useState<PricedSide[]>([]);
  const [result, setResult] = useState<ParlayEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plus = useMemo(
    () =>
      [...snapshot.nfl.board, ...snapshot.ncaaf.board].flatMap((row) =>
        row.report.priced
          .filter((side) => side.plusEv)
          .map((side) => ({
            ...side,
            label: `${row.game.away.abbreviation}@${row.game.home.abbreviation} ${side.label}`,
          })),
      ),
    [snapshot],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">+EV parlay builder</h1>
        <p className="mute text-sm max-w-3xl">
          A parlay compounds ROI only when every leg has edge larger than juice. Adding a
          break-even or -EV leg compounds the vig against you. Same-game legs are correlated;
          this calculator assumes independence.
        </p>
      </div>
      <div className="panel p-3 max-h-80 overflow-auto space-y-1 text-sm">
        {plus.length === 0 ? (
          <div className="mute">No +EV sides on the current board.</div>
        ) : (
          plus.map((side) => {
            const checked = selected.some((row) => row.label === side.label);
            return (
              <label key={side.label} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelected((cur) =>
                      checked ? cur.filter((row) => row.label !== side.label) : [...cur, side],
                    );
                  }}
                />
                <span>{side.label}</span>
                <span className="mute">P {pct(side.handicappedP)} S {pct(side.impliedS)} EV {evPct(side.evPerUnit)}</span>
              </label>
            );
          })
        )}
      </div>
      <button
        type="button"
        className="px-3 py-2 border border-[var(--accent)] text-[var(--accent)] text-sm"
        onClick={() => {
          setError(null);
          void fetch("/api/lab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "parlay",
              legs: selected.map((side) => ({
                label: side.label,
                p: side.handicappedP,
                americanOdds: side.americanOdds,
              })),
            }),
          })
            .then(async (response) => {
              const payload = (await response.json()) as ParlayEvaluation | { error?: string };
              if (!response.ok) {
                throw new Error("error" in payload ? payload.error : "parlay failed");
              }
              setResult(payload as ParlayEvaluation);
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "parlay failed"));
        }}
      >
        Evaluate parlay
      </button>
      {error ? <div className="bad text-sm">{error}</div> : null}
      {result ? (
        <div className="panel p-4 text-sm space-y-2">
          <div>Joint P {pct(result.p, 2)} · joint S {pct(result.s, 2)}</div>
          <div className={result.plusEv ? "good" : "bad"}>EV {evPct(result.evPerUnit)} · ¼ Kelly {pct(result.kellyQuarter, 2)}</div>
          <div>{result.compounds ? "ROI compounds versus the first single." : "This ticket does not compound edge."}</div>
          {result.warning ? <div className="warn">{result.warning}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ParlayPage() {
  return <SnapshotLoader>{(snapshot) => <ParlayBuilder snapshot={snapshot} />}</SnapshotLoader>;
}
