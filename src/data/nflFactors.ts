import { createReadStream } from "node:fs";
import readline from "node:readline";
import { cachedDownload } from "./httpCache";
import { csvNumber, parseCsvLine } from "./csv";
import { indexFactors, lookupFactors, type FactorStore } from "@/src/lib/rithmm/store";
import { scoresFromRaw } from "@/src/lib/rithmm/normalize";
import { processCard } from "@/src/lib/processMatchup";
import type { TeamFactors } from "@/src/lib/rithmm/types";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download/stats_team";

type NflGameRow = {
  season: number;
  week: number;
  team: string;
  opponent: string;
  gameId: string;
  attempts: number;
  carries: number;
  passingEpa: number;
  rushingEpa: number;
  cpoe: number;
  sacks: number;
  defSacks: number;
  defInt: number;
  passing20?: number;
  rushing20?: number;
  passingFirstDowns?: number;
  rushingFirstDowns?: number;
  defQbHits?: number;
  fumblesLost?: number;
  fumblesTotal?: number;
  defFumblesForced?: number;
  fumbleRecoveryOpp?: number;
};

function priorWeight(season: number, asOfSeason: number): number {
  if (season === asOfSeason) {
    return 1;
  }
  if (season === asOfSeason - 1) {
    return 0.65;
  }
  return 0.3;
}

function beforeCutoff(row: NflGameRow, season: number, week: number): boolean {
  if (row.season < season) {
    return true;
  }
  return row.season === season && row.week < week;
}

async function loadSeasonRows(season: number): Promise<NflGameRow[]> {
  const file = await cachedDownload({
    url: `${BASE}/stats_team_week_${season}.csv`,
    fileName: `nfl-stats-team-week-${season}.csv`,
  });
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header: string[] | null = null;
  const rows: NflGameRow[] = [];
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    const cols = parseCsvLine(line);
    const rec = Object.fromEntries(header.map((key, i) => [key, cols[i] ?? ""]));
    const team = rec.team;
    const opponent = rec.opponent_team;
    const gameId = rec.game_id;
    if (!team || !opponent || !gameId) {
      continue;
    }
    if ((rec.season_type || "REG") !== "REG" && rec.season_type !== "POST") {
      continue;
    }
    rows.push({
      season: Number(rec.season) || season,
      week: Number(rec.week) || 0,
      team,
      opponent,
      gameId,
      attempts: csvNumber(rec.attempts) ?? 0,
      carries: csvNumber(rec.carries) ?? 0,
      passingEpa: csvNumber(rec.passing_epa) ?? 0,
      rushingEpa: csvNumber(rec.rushing_epa) ?? 0,
      cpoe: csvNumber(rec.passing_cpoe) ?? 0,
      sacks: csvNumber(rec.sacks_suffered) ?? 0,
      defSacks: csvNumber(rec.def_sacks) ?? 0,
      defInt: csvNumber(rec.def_interceptions) ?? 0,
      passing20: csvNumber(rec.passing_20) ?? 0,
      rushing20: csvNumber(rec.rushing_20) ?? 0,
      passingFirstDowns: csvNumber(rec.passing_first_downs) ?? 0,
      rushingFirstDowns: csvNumber(rec.rushing_first_downs) ?? 0,
      defQbHits: csvNumber(rec.def_qb_hits) ?? 0,
      fumblesLost: csvNumber(rec.fumbles_lost_total) ?? 0,
      fumblesTotal: csvNumber(rec.fumbles_total) ?? 0,
      defFumblesForced: csvNumber(rec.def_fumbles_forced) ?? 0,
      fumbleRecoveryOpp: csvNumber(rec.fumble_recovery_opp) ?? 0,
    });
  }
  return rows;
}

export function buildNflFactorsAt(rows: NflGameRow[], season: number, week: number): TeamFactors[] {
  const usable = rows.filter((row) => beforeCutoff(row, season, week));
  const byGame = new Map<string, NflGameRow[]>();
  for (const row of usable) {
    const list = byGame.get(row.gameId) ?? [];
    list.push(row);
    byGame.set(row.gameId, list);
  }

  type Acc = {
    team: string;
    games: number;
    passEpa: number;
    passPlays: number;
    rushEpa: number;
    rushPlays: number;
    cpoe: number;
    cpoeW: number;
    sackRate: number;
    sackW: number;
    defPassEpa: number;
    defPassPlays: number;
    defRushEpa: number;
    defRushPlays: number;
    plays: number;
    explosive: number;
    explosiveAllowed: number;
    firstDowns: number;
    firstDownsAllowed: number;
    defSacks: number;
    defPassRushDen: number;
    fumblesLost: number;
    fumblesTotal: number;
    defForced: number;
    defRecovered: number;
  };
  const teams = new Map<string, Acc>();
  const ensure = (team: string): Acc => {
    const existing = teams.get(team);
    if (existing) {
      return existing;
    }
    const created: Acc = {
      team,
      games: 0,
      passEpa: 0,
      passPlays: 0,
      rushEpa: 0,
      rushPlays: 0,
      cpoe: 0,
      cpoeW: 0,
      sackRate: 0,
      sackW: 0,
      defPassEpa: 0,
      defPassPlays: 0,
      defRushEpa: 0,
      defRushPlays: 0,
      plays: 0,
      explosive: 0,
      explosiveAllowed: 0,
      firstDowns: 0,
      firstDownsAllowed: 0,
      defSacks: 0,
      defPassRushDen: 0,
      fumblesLost: 0,
      fumblesTotal: 0,
      defForced: 0,
      defRecovered: 0,
    };
    teams.set(team, created);
    return created;
  };

  for (const [gameId, pair] of byGame) {
    if (pair.length < 2) {
      continue;
    }
    const home = pair[0];
    const away = pair.find((row) => row.team !== home?.team) ?? pair[1];
    if (!home || !away) {
      continue;
    }
    void gameId;
    for (const [us, them] of [
      [home, away],
      [away, home],
    ] as const) {
      const acc = ensure(us.team);
      const w = priorWeight(us.season, season);
      acc.games += w;
      acc.passEpa += us.passingEpa * w;
      acc.passPlays += Math.max(us.attempts, 1) * w;
      acc.rushEpa += us.rushingEpa * w;
      acc.rushPlays += Math.max(us.carries, 1) * w;
      acc.cpoe += us.cpoe * w;
      acc.cpoeW += w;
      acc.sackRate += us.sacks * w;
      acc.sackW += Math.max(us.attempts + us.sacks, 1) * w;
      acc.defPassEpa += them.passingEpa * w;
      acc.defPassPlays += Math.max(them.attempts, 1) * w;
      acc.defRushEpa += them.rushingEpa * w;
      acc.defRushPlays += Math.max(them.carries, 1) * w;
      acc.plays += (us.attempts + us.carries) * w;
      acc.explosive += ((us.passing20 ?? 0) + (us.rushing20 ?? 0)) * w;
      acc.explosiveAllowed += ((them.passing20 ?? 0) + (them.rushing20 ?? 0)) * w;
      acc.firstDowns += ((us.passingFirstDowns ?? 0) + (us.rushingFirstDowns ?? 0)) * w;
      acc.firstDownsAllowed += ((them.passingFirstDowns ?? 0) + (them.rushingFirstDowns ?? 0)) * w;
      acc.defSacks += (us.defSacks + 0.45 * (us.defQbHits ?? 0)) * w;
      acc.defPassRushDen += Math.max(them.attempts + them.sacks, 1) * w;
      acc.fumblesLost += (us.fumblesLost ?? 0) * w;
      acc.fumblesTotal += (us.fumblesTotal ?? 0) * w;
      acc.defForced += (us.defFumblesForced ?? 0) * w;
      acc.defRecovered += (us.fumbleRecoveryOpp ?? 0) * w;
    }
  }

  const passOff = new Map<string, number>();
  const rushOff = new Map<string, number>();
  const passDef = new Map<string, number>();
  const rushDef = new Map<string, number>();
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  const pace = new Map<string, number>();
  const successOff = new Map<string, number>();
  const successDef = new Map<string, number>();
  const explosiveOff = new Map<string, number>();
  const explosiveDef = new Map<string, number>();
  const protection = new Map<string, number>();
  const passRush = new Map<string, number>();
  const turnoverLuck = new Map<string, number>();
  const passRate = new Map<string, number>();

  for (const acc of teams.values()) {
    const pass = acc.passPlays > 0 ? acc.passEpa / acc.passPlays : 0;
    const rush = acc.rushPlays > 0 ? acc.rushEpa / acc.rushPlays : 0;
    const dPass = acc.defPassPlays > 0 ? acc.defPassEpa / acc.defPassPlays : 0;
    const dRush = acc.defRushPlays > 0 ? acc.defRushEpa / acc.defRushPlays : 0;
    const sackPenalty = acc.sackW > 0 ? acc.sackRate / acc.sackW : 0;
    passOff.set(acc.team, pass + 0.15 * (acc.cpoeW > 0 ? acc.cpoe / acc.cpoeW / 100 : 0) - 0.8 * sackPenalty);
    rushOff.set(acc.team, rush);
    passDef.set(acc.team, dPass);
    rushDef.set(acc.team, dRush);
    offense.set(acc.team, 0.65 * pass + 0.35 * rush);
    defense.set(acc.team, 0.65 * dPass + 0.35 * dRush);
    pace.set(acc.team, acc.games > 0 ? acc.plays / acc.games : 62);
    successOff.set(acc.team, acc.plays > 0 ? acc.firstDowns / acc.plays : 0);
    successDef.set(acc.team, acc.plays > 0 ? acc.firstDownsAllowed / acc.plays : 0);
    explosiveOff.set(acc.team, acc.plays > 0 ? acc.explosive / acc.plays : 0);
    explosiveDef.set(acc.team, acc.plays > 0 ? acc.explosiveAllowed / acc.plays : 0);
    protection.set(acc.team, sackPenalty);
    passRush.set(acc.team, acc.defPassRushDen > 0 ? acc.defSacks / acc.defPassRushDen : 0);
    const recovery = acc.defForced > 0.5 ? acc.defRecovered / acc.defForced : 0.5;
    const lost = acc.fumblesTotal > 0.5 ? acc.fumblesLost / acc.fumblesTotal : 0.5;
    turnoverLuck.set(acc.team, recovery - lost);
    passRate.set(acc.team, acc.plays > 0 ? acc.passPlays / acc.plays : 0.55);
  }

  const passOffS = scoresFromRaw(passOff);
  const rushOffS = scoresFromRaw(rushOff);
  const passDefS = scoresFromRaw(passDef, true);
  const rushDefS = scoresFromRaw(rushDef, true);
  const offS = scoresFromRaw(offense);
  const defS = scoresFromRaw(defense, true);
  const rankS = scoresFromRaw(
    new Map([...offense].map(([id, off]) => [id, off - (defense.get(id) ?? 0)])),
  );
  const successOffS = scoresFromRaw(successOff);
  const successDefS = scoresFromRaw(successDef, true);
  const explosiveOffS = scoresFromRaw(explosiveOff);
  const explosiveDefS = scoresFromRaw(explosiveDef, true);
  const protectionS = scoresFromRaw(protection, true);
  const passRushS = scoresFromRaw(passRush);
  const luckS = scoresFromRaw(turnoverLuck);
  const passRateS = scoresFromRaw(passRate);

  return [...teams.values()].map((acc) => ({
    teamId: `nfl:${acc.team}`,
    abbreviation: acc.team,
    name: acc.team,
    sampleGames: Math.round(acc.games),
    asOfSeason: season,
    asOfWeek: Math.max(week - 1, 0),
    running: {
      offense: rushOffS.get(acc.team) ?? 50,
      defense: rushDefS.get(acc.team) ?? 50,
    },
    passing: {
      offense: passOffS.get(acc.team) ?? 50,
      defense: passDefS.get(acc.team) ?? 50,
    },
    offense: offS.get(acc.team) ?? 50,
    defense: defS.get(acc.team) ?? 50,
    ranks: rankS.get(acc.team) ?? 50,
    pace: pace.get(acc.team) ?? 62,
    source: "nflverse-stats-team-week",
    process: processCard({
      successOff: successOffS.get(acc.team) ?? 50,
      successDef: successDefS.get(acc.team) ?? 50,
      explosiveOff: explosiveOffS.get(acc.team) ?? 50,
      explosiveDef: explosiveDefS.get(acc.team) ?? 50,
      protection: protectionS.get(acc.team) ?? 50,
      passRush: passRushS.get(acc.team) ?? 50,
      turnoverLuck: luckS.get(acc.team) ?? 50,
      passRate: passRateS.get(acc.team) ?? 50,
    }),
  }));
}

export async function loadNflFactorStore(seasons: number[]): Promise<FactorStore> {
  if (seasons.length === 0) {
    throw new Error("seasons is required");
  }
  const rows = (await Promise.all(seasons.map((season) => loadSeasonRows(season).catch(() => [])))).flat();
  const cache = new Map<string, TeamFactors[]>();
  const snapshot = (season: number, week: number): TeamFactors[] => {
    const key = `${season}:${week}`;
    const hit = cache.get(key);
    if (hit) {
      return hit;
    }
    const built = buildNflFactorsAt(rows, season, week);
    cache.set(key, built);
    return built;
  };
  const latestSeason = Math.max(...seasons);
  const latestWeek =
    rows.filter((row) => row.season === latestSeason).reduce((max, row) => Math.max(max, row.week), 0) + 1;
  const latestRows = snapshot(latestSeason, latestWeek);
  const latestIndex = indexFactors(latestRows);

  return {
    lookup: (teamId, season, week) => {
      const indexed = indexFactors(snapshot(season, week));
      return lookupFactors(indexed, teamId);
    },
    latest: (teamId) => lookupFactors(latestIndex, teamId),
    allLatest: () => latestRows,
  };
}
