import { createReadStream } from "node:fs";
import readline from "node:readline";
import { cachedDownload } from "./httpCache";
import { csvNumber, parseCsvLine } from "./csv";
import { indexFactors, lookupFactors, type FactorStore } from "@/src/lib/rithmm/store";
import { scoresFromRaw } from "@/src/lib/rithmm/normalize";
import { processCard } from "@/src/lib/processMatchup";
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
  successOff?: number;
  successDef?: number;
  explosiveOff?: number;
  explosiveDef?: number;
  havocOff?: number;
  havocDef?: number;
  redZoneOff?: number;
  redZoneDef?: number;
  thirdDownOff?: number;
  thirdDownDef?: number;
  passRateOff?: number;
  stuffedOff?: number;
  stuffedDef?: number;
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
      successOff: csvNumber(rec.success_off),
      successDef: csvNumber(rec.success_def),
      explosiveOff: csvNumber(rec.explosive_off),
      explosiveDef: csvNumber(rec.explosive_def),
      havocOff: csvNumber(rec.havoc_off),
      havocDef: csvNumber(rec.havoc_def),
      redZoneOff: csvNumber(rec.red_zone_success_off),
      redZoneDef: csvNumber(rec.red_zone_success_def),
      thirdDownOff: csvNumber(rec.third_down_success_off),
      thirdDownDef: csvNumber(rec.third_down_success_def),
      passRateOff: csvNumber(rec.passrate_off),
      stuffedOff: csvNumber(rec.play_stuffed_off),
      stuffedDef: csvNumber(rec.play_stuffed_def),
    });
  }
  return rows;
}

const MIN_SLICE_TEAMS = 40;

function latestUsableWeek(rows: CfbWeekRow[], season: number): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.season !== season || row.games <= 0) {
      continue;
    }
    counts.set(row.throughWeek, (counts.get(row.throughWeek) ?? 0) + 1);
  }
  let bestWeek = 0;
  let bestCount = 0;
  for (const [week, count] of counts) {
    if (count < MIN_SLICE_TEAMS) {
      continue;
    }
    if (count > bestCount || (count === bestCount && week > bestWeek)) {
      bestWeek = week;
      bestCount = count;
    }
  }
  return bestWeek;
}

export function rowsToFactors(slice: CfbWeekRow[], season: number, asOfWeek: number): TeamFactors[] {
  const passOff = new Map<string, number>();
  const rushOff = new Map<string, number>();
  const passDef = new Map<string, number>();
  const rushDef = new Map<string, number>();
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  const ranks = new Map<string, number>();
  const meta = new Map<string, CfbWeekRow>();
  const successOff = new Map<string, number>();
  const successDef = new Map<string, number>();
  const explosiveOff = new Map<string, number>();
  const explosiveDef = new Map<string, number>();
  const havocOff = new Map<string, number>();
  const havocDef = new Map<string, number>();
  const redZoneOff = new Map<string, number>();
  const redZoneDef = new Map<string, number>();
  const thirdDownOff = new Map<string, number>();
  const thirdDownDef = new Map<string, number>();
  const passRate = new Map<string, number>();
  const stuffedOff = new Map<string, number>();
  const stuffedDef = new Map<string, number>();
  let processRows = 0;

  for (const row of slice) {
    passOff.set(row.teamId, row.passOff);
    rushOff.set(row.teamId, row.rushOff);
    passDef.set(row.teamId, row.passDef);
    rushDef.set(row.teamId, row.rushDef);
    offense.set(row.teamId, row.offEpa);
    defense.set(row.teamId, row.defEpa);
    ranks.set(row.teamId, row.netEpa);
    meta.set(row.teamId, row);
    if (row.successOff !== undefined) {
      processRows += 1;
      successOff.set(row.teamId, row.successOff);
      successDef.set(row.teamId, row.successDef ?? 0);
      explosiveOff.set(row.teamId, row.explosiveOff ?? 0);
      explosiveDef.set(row.teamId, row.explosiveDef ?? 0);
      havocOff.set(row.teamId, row.havocOff ?? 0);
      havocDef.set(row.teamId, row.havocDef ?? 0);
      redZoneOff.set(row.teamId, row.redZoneOff ?? 0);
      redZoneDef.set(row.teamId, row.redZoneDef ?? 0);
      thirdDownOff.set(row.teamId, row.thirdDownOff ?? 0);
      thirdDownDef.set(row.teamId, row.thirdDownDef ?? 0);
      passRate.set(row.teamId, row.passRateOff ?? 0);
      stuffedOff.set(row.teamId, row.stuffedOff ?? 0);
      stuffedDef.set(row.teamId, row.stuffedDef ?? 0);
    }
  }

  const passOffS = scoresFromRaw(passOff);
  const rushOffS = scoresFromRaw(rushOff);
  const passDefS = scoresFromRaw(passDef, true);
  const rushDefS = scoresFromRaw(rushDef, true);
  const offS = scoresFromRaw(offense);
  const defS = scoresFromRaw(defense, true);
  const rankS = scoresFromRaw(ranks);
  const successOffS = scoresFromRaw(successOff);
  const successDefS = scoresFromRaw(successDef, true);
  const explosiveOffS = scoresFromRaw(explosiveOff);
  const explosiveDefS = scoresFromRaw(explosiveDef, true);
  const protectionS = scoresFromRaw(havocOff, true);
  const passRushS = scoresFromRaw(havocDef);
  const redZoneOffS = scoresFromRaw(redZoneOff);
  const redZoneDefS = scoresFromRaw(redZoneDef, true);
  const thirdDownOffS = scoresFromRaw(thirdDownOff);
  const thirdDownDefS = scoresFromRaw(thirdDownDef, true);
  const passRateS = scoresFromRaw(passRate);
  const stuffedOffS = scoresFromRaw(stuffedOff, true);
  const stuffedDefS = scoresFromRaw(stuffedDef);

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
    process:
      processRows > 0
        ? processCard({
            successOff: successOffS.get(row.teamId) ?? 50,
            successDef: successDefS.get(row.teamId) ?? 50,
            explosiveOff: explosiveOffS.get(row.teamId) ?? 50,
            explosiveDef: explosiveDefS.get(row.teamId) ?? 50,
            protection: ((protectionS.get(row.teamId) ?? 50) + (stuffedOffS.get(row.teamId) ?? 50)) / 2,
            passRush: ((passRushS.get(row.teamId) ?? 50) + (stuffedDefS.get(row.teamId) ?? 50)) / 2,
            redZoneOff: redZoneOffS.get(row.teamId) ?? 50,
            redZoneDef: redZoneDefS.get(row.teamId) ?? 50,
            thirdDownOff: thirdDownOffS.get(row.teamId) ?? 50,
            thirdDownDef: thirdDownDefS.get(row.teamId) ?? 50,
            passRate: passRateS.get(row.teamId) ?? 50,
          })
        : undefined,
  }));
}

export function selectCfbSlice(
  rows: CfbWeekRow[],
  season: number,
  week: number,
): { slice: CfbWeekRow[]; asOfSeason: number; asOfWeek: number } {
  const targetWeek = week - 1;
  const current = rows.filter(
    (row) =>
      row.season === season &&
      row.throughWeek === targetWeek &&
      targetWeek > 0 &&
      row.games > 0,
  );
  if (current.length >= MIN_SLICE_TEAMS) {
    return { slice: current, asOfSeason: season, asOfWeek: targetWeek };
  }
  const currentMax = latestUsableWeek(rows, season);
  if (currentMax > 0 && week > currentMax) {
    const latest = rows.filter((row) => row.season === season && row.throughWeek === currentMax && row.games > 0);
    if (latest.length > 0) {
      return { slice: latest, asOfSeason: season, asOfWeek: currentMax };
    }
  }
  const priorSeason = season - 1;
  const priorMax = latestUsableWeek(rows, priorSeason);
  const prior = rows.filter((row) => row.season === priorSeason && row.throughWeek === priorMax && row.games > 0);
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
  const usable = latestUsableWeek(rows, latestSeason);
  const latestRows = snapshot(latestSeason, usable > 0 ? usable + 1 : 1);
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
