"use client";

import { useMemo, useState } from "react";
import { SnapshotLoader } from "../components/SnapshotLoader";
import type { League, MatchupReport, TeamRating } from "@/src/lib/types";
import type { ModelSnapshot } from "@/src/data/snapshot";
import { american, evPct, pct, pts } from "@/src/lib/format";

function LabForm({ snapshot }: { snapshot: ModelSnapshot }) {
  const [league, setLeague] = useState<League>("nfl");
  const [homeId, setHomeId] = useState("");
  const [awayId, setAwayId] = useState("");
  const [homeMl, setHomeMl] = useState("-150");
  const [awayMl, setAwayMl] = useState("+130");
  const [homeSpread, setHomeSpread] = useState("-3");
  const [spreadOdds, setSpreadOdds] = useState("-110");
  const [awaySpreadOdds, setAwaySpreadOdds] = useState("-110");
  const [total, setTotal] = useState("45.5");
  const [overOdds, setOverOdds] = useState("-110");
  const [underOdds, setUnderOdds] = useState("-110");
  const [qbHome, setQbHome] = useState("0");
  const [qbAway, setQbAway] = useState("0");
  const [report, setReport] = useState<MatchupReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const teams = useMemo(
    () => pack.ratings.slice().sort((a, b) => a.team.name.localeCompare(b.team.name)),
    [pack.ratings],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Handicap lab</h1>
        <p className="mute text-sm max-w-3xl">
          Price any rated matchup against the odds you were actually offered. Paste your book, not a
          consensus screen, and add a QB adjustment if a starter is out.
        </p>
      </div>
      <form
        className="panel p-4 grid gap-3 md:grid-cols-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          void fetch("/api/lab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "matchup",
              league,
              homeId,
              awayId,
              qbHome: Number(qbHome),
              qbAway: Number(qbAway),
              market: {
                homeMoneyline: Number(homeMl),
                awayMoneyline: Number(awayMl),
                homeSpread: Number(homeSpread),
                homeSpreadOdds: Number(spreadOdds),
                awaySpreadOdds: Number(awaySpreadOdds),
                total: Number(total),
                overOdds: Number(overOdds),
                underOdds: Number(underOdds),
              },
            }),
          })
            .then(async (response) => {
              const payload = (await response.json()) as MatchupReport | { error?: string };
              if (!response.ok) {
                throw new Error("error" in payload ? payload.error : "lab failed");
              }
              setReport(payload as MatchupReport);
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "lab failed"))
            .finally(() => setPending(false));
        }}
      >
        <label className="space-y-1">
          <div className="mute text-xs uppercase">League</div>
          <select
            className="w-full bg-[var(--bg)] border border-[var(--line)] px-2 py-1.5"
            value={league}
            onChange={(e) => {
              setLeague(e.target.value as League);
              setHomeId("");
              setAwayId("");
            }}
          >
            <option value="nfl">NFL</option>
            <option value="ncaaf">NCAA Football</option>
          </select>
        </label>
        <TeamSelect label="Away" value={awayId} teams={teams} onChange={setAwayId} />
        <TeamSelect label="Home" value={homeId} teams={teams} onChange={setHomeId} />
        <div className="space-y-1">
          <div className="mute text-xs uppercase">QB adj (pts)</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="bg-[var(--bg)] border border-[var(--line)] px-2 py-1.5" value={qbAway} onChange={(e) => setQbAway(e.target.value)} />
            <input className="bg-[var(--bg)] border border-[var(--line)] px-2 py-1.5" value={qbHome} onChange={(e) => setQbHome(e.target.value)} />
          </div>
        </div>
        <Field label="Home ML" value={homeMl} onChange={setHomeMl} />
        <Field label="Away ML" value={awayMl} onChange={setAwayMl} />
        <Field label="Home spread" value={homeSpread} onChange={setHomeSpread} />
        <Field label="Home spread odds" value={spreadOdds} onChange={setSpreadOdds} />
        <Field label="Away spread odds" value={awaySpreadOdds} onChange={setAwaySpreadOdds} />
        <Field label="Total" value={total} onChange={setTotal} />
        <Field label="Over odds" value={overOdds} onChange={setOverOdds} />
        <Field label="Under odds" value={underOdds} onChange={setUnderOdds} />
        <div className="md:col-span-4">
          <button type="submit" disabled={pending} className="px-3 py-2 border border-[var(--accent)] text-[var(--accent)] disabled:opacity-50">
            {pending ? "Pricing…" : "Price matchup"}
          </button>
        </div>
      </form>
      {error ? <div className="bad text-sm">{error}</div> : null}
      {report ? (
        <div className="panel overflow-x-auto">
          <div className="px-3 py-3 text-sm">
            Projected {report.projection.awayScore.toFixed(1)}–{report.projection.homeScore.toFixed(1)}
            {" "}({pts(report.projection.margin)}, tot {report.projection.total.toFixed(1)})
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase mute">
              <tr className="border-y border-[var(--line)]">
                <th className="text-left px-3 py-2">Side</th>
                <th className="text-right px-3 py-2">P</th>
                <th className="text-right px-3 py-2">S</th>
                <th className="text-right px-3 py-2">EV</th>
                <th className="text-right px-3 py-2">¼ Kelly</th>
              </tr>
            </thead>
            <tbody>
              {report.priced.map((side) => (
                <tr key={`${side.betType}-${side.side}`} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2">{side.label} {american(side.americanOdds)} {side.plusEv ? <span className="good">+EV</span> : null}</td>
                  <td className="px-3 py-2 text-right num">{pct(side.handicappedP)}</td>
                  <td className="px-3 py-2 text-right num">{pct(side.impliedS)}</td>
                  <td className={`px-3 py-2 text-right num ${side.plusEv ? "good" : "bad"}`}>{evPct(side.evPerUnit)}</td>
                  <td className="px-3 py-2 text-right num">{pct(Math.max(0, side.kellyQuarter), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      {label}
      <input className="w-full bg-[var(--bg)] border border-[var(--line)] px-2 py-1.5" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TeamSelect({
  label,
  value,
  teams,
  onChange,
}: {
  label: string;
  value: string;
  teams: TeamRating[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <div className="mute text-xs uppercase">{label}</div>
      <select className="w-full bg-[var(--bg)] border border-[var(--line)] px-2 py-1.5" value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Select</option>
        {teams.map((row) => (
          <option key={row.team.id} value={row.team.id}>{row.team.abbreviation} — {row.team.name}</option>
        ))}
      </select>
    </label>
  );
}

export default function LabPage() {
  return <SnapshotLoader>{(snapshot) => <LabForm snapshot={snapshot} />}</SnapshotLoader>;
}
