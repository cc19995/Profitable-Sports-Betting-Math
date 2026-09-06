import type { TeamFactors } from "./types";

export type FactorStore = {
  lookup: (teamId: string, season: number, week: number) => TeamFactors | undefined;
  latest: (teamId: string) => TeamFactors | undefined;
  allLatest: () => TeamFactors[];
};

function aliases(teamId: string, extra?: string[]): string[] {
  const out = new Set<string>([teamId, ...((extra ?? []).filter((value) => value.length > 0))]);
  const ncaaf = /^ncaaf:(\d+)$/.exec(teamId);
  if (ncaaf?.[1]) {
    out.add(ncaaf[1]);
  }
  const nfl = /^nfl:([A-Z0-9]+)$/.exec(teamId);
  if (nfl?.[1]) {
    out.add(nfl[1]);
  }
  return [...out];
}

export function lookupFactors(
  byKey: Map<string, TeamFactors>,
  teamId: string,
  extra?: string[],
): TeamFactors | undefined {
  for (const key of aliases(teamId, extra)) {
    const hit = byKey.get(key);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export function indexFactors(rows: TeamFactors[]): Map<string, TeamFactors> {
  const map = new Map<string, TeamFactors>();
  for (const row of rows) {
    map.set(row.teamId, row);
    map.set(row.abbreviation, row);
    const numeric = /^ncaaf:(\d+)$/.exec(row.teamId)?.[1];
    if (numeric) {
      map.set(numeric, row);
    }
  }
  return map;
}
