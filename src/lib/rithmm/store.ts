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

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function nameKeys(name: string): string[] {
  const normalized = normalizeName(name);
  if (normalized.length === 0) {
    return [];
  }
  const parts = normalized.split(" ");
  const keys = [normalized];
  if (parts.length > 1) {
    keys.push(parts.slice(0, -1).join(" "));
  }
  if (parts.length > 2) {
    keys.push(parts.slice(0, -2).join(" "));
  }
  return [...new Set(keys.filter((key) => key.length >= 4))];
}

export function lookupFactors(
  byKey: Map<string, TeamFactors>,
  teamId: string,
  extra?: string[],
): TeamFactors | undefined {
  for (const key of aliases(teamId, extra)) {
    const hit = byKey.get(key) ?? byKey.get(normalizeName(key));
    if (hit) {
      return hit;
    }
    for (const nameKey of nameKeys(key)) {
      const named = byKey.get(nameKey);
      if (named) {
        return named;
      }
    }
  }
  return undefined;
}

export function indexFactors(rows: TeamFactors[]): Map<string, TeamFactors> {
  const map = new Map<string, TeamFactors>();
  for (const row of rows) {
    map.set(row.teamId, row);
    map.set(row.abbreviation, row);
    map.set(normalizeName(row.abbreviation), row);
    map.set(normalizeName(row.name), row);
    for (const key of nameKeys(row.name)) {
      if (!map.has(key)) {
        map.set(key, row);
      }
    }
    const numeric = /^ncaaf:(\d+)$/.exec(row.teamId)?.[1];
    if (numeric) {
      map.set(numeric, row);
    }
  }
  return map;
}
