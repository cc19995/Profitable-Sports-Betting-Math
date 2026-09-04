"use client";

import { useMemo, type ReactNode } from "react";
import type { ModelSnapshot } from "@/src/data/snapshot";
import type { League } from "@/src/lib/types";
import { kickoffDateKey, kickoffDateLabel } from "@/src/lib/format";

export function DeskFilters({
  snapshot,
  league,
  dateKey,
  onLeagueChange,
  onDateChange,
  extra,
}: {
  snapshot: ModelSnapshot;
  league: League;
  dateKey: string;
  onLeagueChange: (league: League) => void;
  onDateChange: (dateKey: string) => void;
  extra?: ReactNode;
}) {
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

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {(["nfl", "ncaaf"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            onLeagueChange(value);
            if (dateKey !== "all") {
              const nextPack = value === "nfl" ? snapshot.nfl : snapshot.ncaaf;
              const stillExists = nextPack.board.some(
                (row) => kickoffDateKey(row.game.kickoffIso) === dateKey,
              );
              if (!stillExists) {
                onDateChange("all");
              }
            }
          }}
          className={`px-3 py-1.5 text-sm border ${league === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
        >
          {value === "nfl" ? "NFL" : "NCAA Football"}
        </button>
      ))}
      <label className="ml-3 text-sm mute flex items-center gap-2">
        Date
        <input
          type="date"
          value={dateKey === "all" ? "" : dateKey}
          min={dates[0]?.[0]}
          max={dates[dates.length - 1]?.[0]}
          onChange={(event) => onDateChange(event.target.value || "all")}
          className="bg-[var(--bg)] border border-[var(--line)] px-2 py-1 text-[var(--ink)]"
        />
      </label>
      <button
        type="button"
        onClick={() => onDateChange("all")}
        className={`px-3 py-1.5 text-sm border ${dateKey === "all" ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
      >
        All dates
      </button>
      {dates.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onDateChange(key)}
          className={`px-3 py-1.5 text-sm border ${dateKey === key ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] mute"}`}
        >
          {label}
        </button>
      ))}
      {extra}
    </div>
  );
}
