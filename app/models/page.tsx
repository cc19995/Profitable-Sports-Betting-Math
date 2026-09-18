"use client";

import { useState } from "react";
import { SnapshotLoader } from "../components/SnapshotLoader";
import type { League } from "@/src/lib/types";
import { HOUSE_FACTORS } from "@/src/lib/rithmm/types";
import { getHouseModel } from "@/src/lib/rithmm/house";
import type { ModelSnapshot } from "@/src/data/snapshot";

function ModelsInner({ snapshot }: { snapshot: ModelSnapshot }) {
  const [league, setLeague] = useState<League>("ncaaf");
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const house = pack.houseModel ?? getHouseModel(league);
  const book = (pack.factorBook ?? []).slice().sort((a, b) => b.ranks - a.ranks);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">House models</h1>
        <p className="mute text-sm max-w-3xl">
          Rithmm structure, our weights and public data. Statistics (EPA, success, tempo) roll up
          into five house factors — Running, Passing, Offense, Defense, Ranks — then a
          league-specific House model turns factor mismatches into P. DTM is P minus S. NFL and
          NCAAF are separate engines. Sliders live in Lab; the live desk uses House.
        </p>
      </div>
      <div className="flex gap-2">
        {(["ncaaf", "nfl"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setLeague(value)}
            className={`px-3 py-1.5 text-sm border ${league === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
          >
            {value === "nfl" ? "NFL House" : "NCAAF House"}
          </button>
        ))}
      </div>
      <div className="panel p-4 text-sm space-y-2">
        <div className="font-medium">
          {house.name} · {house.league.toUpperCase()}
        </div>
        <div className="mute">{house.description}</div>
        <div className="grid gap-2 md:grid-cols-5 pt-2">
          {HOUSE_FACTORS.map((factor) => (
            <div key={factor} className="border border-[var(--line)] p-2">
              <div className="text-[11px] uppercase mute">{factor}</div>
              <div className="text-lg num">{Math.round(house.weights[factor] * 100)}%</div>
            </div>
          ))}
        </div>
        <div className="mute text-xs">
          {book.length} teams with factor cards · holdout{" "}
          {pack.backtest ? `${pack.backtest.n} bets, ${(pack.backtest.roi * 100).toFixed(1)}% ROI` : "n/a"}
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase mute tracking-wider">
            <tr className="border-b border-[var(--line)]">
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-right px-3 py-2">Pass</th>
              <th className="text-right px-3 py-2">Run</th>
              <th className="text-right px-3 py-2">Off</th>
              <th className="text-right px-3 py-2">Def</th>
              <th className="text-right px-3 py-2">Ranks</th>
              <th className="text-right px-3 py-2">Pace</th>
              <th className="text-right px-3 py-2">G</th>
            </tr>
          </thead>
          <tbody>
            {book.slice(0, 40).map((row) => (
              <tr key={row.teamId} className="border-t border-[var(--line)]">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-right num">{row.passing.offense.toFixed(0)}</td>
                <td className="px-3 py-2 text-right num">{row.running.offense.toFixed(0)}</td>
                <td className="px-3 py-2 text-right num">{row.offense.toFixed(0)}</td>
                <td className="px-3 py-2 text-right num">{row.defense.toFixed(0)}</td>
                <td className="px-3 py-2 text-right num">{row.ranks.toFixed(0)}</td>
                <td className="px-3 py-2 text-right num">{row.pace.toFixed(1)}</td>
                <td className="px-3 py-2 text-right num">{row.sampleGames}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  return <SnapshotLoader>{(snapshot) => <ModelsInner snapshot={snapshot} />}</SnapshotLoader>;
}
