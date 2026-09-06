"use client";

import { useState } from "react";
import { SnapshotLoader } from "../components/SnapshotLoader";
import type { League } from "@/src/lib/types";
import { pts } from "@/src/lib/format";

export default function RatingsPage() {
  const [league, setLeague] = useState<League>("nfl");
  return (
    <SnapshotLoader>
      {(snapshot) => {
        const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
        return (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold">Power ratings</h1>
              <p className="mute text-sm max-w-3xl">
                Opponent-adjusted offense and defense. Net is the spread-relevant power rating.
                Residual margin is how far results have outrun the model — a diagnostic, not a bet.
              </p>
            </div>
            <div className="flex gap-2">
              {(["nfl", "ncaaf"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLeague(value)}
                  className={`px-3 py-1.5 text-sm border ${league === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
                >
                  {value === "nfl" ? "NFL" : "NCAA Football"}
                </button>
              ))}
            </div>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase mute tracking-wider">
                  <tr className="border-b border-[var(--line)]">
                    <th className="text-right px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">Team</th>
                    <th className="text-right px-3 py-2">Net</th>
                    <th className="text-right px-3 py-2">Off</th>
                    <th className="text-right px-3 py-2">Def</th>
                    <th className="text-right px-3 py-2">SOS</th>
                    <th className="text-right px-3 py-2">PF / PA</th>
                    <th className="text-right px-3 py-2">Residual</th>
                    <th className="text-right px-3 py-2">L4</th>
                    <th className="text-right px-3 py-2">G</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.ratings.map((row, index) => (
                    <tr key={row.team.id} className="border-t border-[var(--line)]">
                      <td className="px-3 py-1.5 text-right mute">{index + 1}</td>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{row.team.abbreviation}</span>
                        <span className="mute text-xs ml-2">{row.team.name}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right num font-medium">{pts(row.net)}</td>
                      <td className="px-3 py-1.5 text-right num">{pts(row.offense)}</td>
                      <td className="px-3 py-1.5 text-right num">{pts(row.defense)}</td>
                      <td className="px-3 py-1.5 text-right num">{pts(row.sos)}</td>
                      <td className="px-3 py-1.5 text-right num">{row.avgPointsFor.toFixed(1)} / {row.avgPointsAgainst.toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-right num">{pts(row.residualMargin)}</td>
                      <td className="px-3 py-1.5 text-right num">{pts(row.last4Residual)}</td>
                      <td className="px-3 py-1.5 text-right mute">{row.games}</td>
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
