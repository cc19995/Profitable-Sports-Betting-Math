import { createReadStream } from "node:fs";
import readline from "node:readline";
import { cachedDownload } from "./httpCache";
import { csvNumber, parseCsvLine } from "./csv";
import { indexFactors, lookupFactors, type FactorStore } from "@/src/lib/rithmm/store";
import { scoresFromRaw } from "@/src/lib/rithmm/normalize";
import type { TeamFactors } from "@/src/lib/rithmm/types";

const BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";

type CfbWeekRow = {
  season: number;
  throughWeek: number;
  teamId: string;
  name: string;
  games: number;
  passOff: number;
  rushOff: number;
  passDef: number;
  rushDef: number;
  offEpa: number;
  defEpa: number;
  netEpa: number;
  pace: number;
};

async function loadSeasonSummaries(season: number): Promise<CfbWeekRow[]> {
  const file = await cachedDownload({
    url: `${BASE}/cfb_team_summaries_weekly/cfb_team_summaries_weekly_${season}.csv`,
    fileName: `cfb-team-summaries-weekly-${season}.csv`,
  });
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header: string[] | null = null;
  const rows: CfbWeekRow[] = [];
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    const cols = parseCsvLine(line);
    const rec = Object.fromEntries(header.map((key, i) => [key, cols[i] ?? ""]));
    const teamId = rec.team_id;
    if (!teamId) {
      continue;
    }
    rows.push({
      season,
      throughWeek: csvNumber(rec.through_week) ?? 0,
      teamId,
      name: rec.pos_team || teamId,
      games: csvNumber(rec.valid_games) ?? 0,
      passOff: csvNumber(rec.EPAplay_off_pass) ?? 0,
      rushOff: csvNumber(rec.EPAplay_off_rush) ?? 0,
      passDef: csvNumber(rec.EPAplay_def_pass) ?? 0,
      rushDef: csvNumber(rec.EPAplay_def_rush) ?? 0,
      offEpa: csvNumber(rec.adj_off_epa) ?? csvNumber(rec.EPAplay_off) ?? 0,
      defEpa: csvNumber(rec.adj_def_epa) ?? csvNumber(rec.EPAplay_def) ?? 0,
      netEpa: csvNumber(rec.net_adj_epa) ?? 0,
      pace: csvNumber(rec.playsgame_off) ?? 72,
    });
  }
  return rows;
}

function rowsToFactors(slice: CfbWeekRow[], season: number, asOfWeek: number): TeamFactors[] {
  const passOff = new Map<string, number>();
  const rushOff = new Map<string, number>();
  const passDef = new Map<string, number>();
  const rushDef = new Map<string, number>();
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  const ranks = new Map<string, number>();
  const meta = new Map<string, CfbWeekRow>();

  for (const row of slice) {
    passOff.set(row.teamId, row.passOff);
    rushOff.set(row.teamId, row.rushOff);
    passDef.set(row.teamId, row.passDef);
    rushDef.set(row.teamId, row.rushDef);
    offense.set(row.teamId, row.offEpa);
    defense.set(row.teamId, row.defEpa);
    ranks.set(row.teamId, row.netEpa);
    meta.set(row.teamId, row);
  }

  const passOffS = scoresFromRaw(passOff);
  const rushOffS = scoresFromRaw(rushOff);
  const passDefS = scoresFromRaw(passDef, true);
  const rushDefS = scoresFromRaw(rushDef, true);
  const offS = scoresFromRaw(offense);
  const defS = scoresFromRaw(defense, true);
  const rankS = scoresFromRaw(ranks);

  return [...meta.values()].map((row) => ({
    teamId: `ncaaf:${row.teamId}`,
    abbreviation: row.name,
    name: row.name,
    sampleGames: row.games,
    asOfSeason: season,
    asOfWeek,
    running: {
      offense: rushOffS.get(row.teamId) ?? 50,
      defense: rushDefS.get(row.teamId) ?? 50,
    },
    passing: {
      offense: passOffS.get(row.teamId) ?? 50,
      defense: passDefS.get(row.teamId) ?? 50,
    },
    offense: offS.get(row.teamId) ?? 50,
    defense: defS.get(row.teamId) ?? 50,
    ranks: rankS.get(row.teamId) ?? 50,
    pace: row.pace,
    source: "sportsdataverse-cfb-team-summaries-weekly",
  }));
}

export function selectCfbSlice(
  rows: CfbWeekRow[],
  season: number,
  week: number,
): { slice: CfbWeekRow[]; asOfSeason: number; asOfWeek: number } {
  const targetWeek = week - 1;
  const current = rows.filter((row) => row.season === season && row.throughWeek === targetWeek && targetWeek > 0);
  if (current.length > 0) {
    return { slice: current, asOfSeason: season, asOfWeek: targetWeek };
  }
  const priorSeason = season - 1;
  const priorWeeks = rows.filter((row) => row.season === priorSeason).map((row) => row.throughWeek);
  const priorMax = priorWeeks.length > 0 ? Math.max(...priorWeeks) : 0;
  const prior = rows.filter((row) => row.season === priorSeason && row.throughWeek === priorMax);
  return { slice: prior, asOfSeason: priorSeason, asOfWeek: priorMax };
}

export async function loadCfbFactorStore(seasons: number[]): Promise<FactorStore> {
  if (seasons.length === 0) {
    throw new Error("seasons is required");
  }
  const rows = (await Promise.all(seasons.map((season) => loadSeasonSummaries(season).catch(() => [])))).flat();
  const cache = new Map<string, TeamFactors[]>();
  const snapshot = (season: number, week: number): TeamFactors[] => {
    const key = `${season}:${week}`;
    const hit = cache.get(key);
    if (hit) {
      return hit;
    }
    const selected = selectCfbSlice(rows, season, week);
    const built = rowsToFactors(selected.slice, selected.asOfSeason, selected.asOfWeek);
    cache.set(key, built);
    return built;
  };
  const latestSeason = Math.max(...seasons);
  const latestWeekInSeason =
    rows.filter((row) => row.season === latestSeason).reduce((max, row) => Math.max(max, row.throughWeek), 0) + 1;
  const latestRows = snapshot(latestSeason, Math.max(latestWeekInSeason, 1));
  const latestIndex = indexFactors(latestRows);

  return {
    lookup: (teamId, season, week) => {
      const indexed = indexFactors(snapshot(season, week));
      return lookupFactors(indexed, teamId, []);
    },
    latest: (teamId) => lookupFactors(latestIndex, teamId),
    allLatest: () => latestRows,
  };
}
