import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseAvailabilityItem,
  type AvailabilityItem,
  type AvailabilityPosition,
  type AvailabilitySource,
  type AvailabilityStatus,
} from "@/src/lib/availability";
import type { UpcomingGame } from "@/src/lib/types";
import { fetchEspnJson } from "./espn";

const OPERATOR_FILE = path.join(process.cwd(), "data", "availability.json");
const ESPN_INJURIES =
  "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/injuries";
const MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

type EspnInjuriesPayload = {
  injuries?: unknown[];
};

type OperatorGameReport = {
  gameId?: string;
  homeAbbreviation?: string;
  awayAbbreviation?: string;
  kickoffDateKey?: string;
  items?: unknown[];
};

function espnTeamKey(teamId: string): string {
  return teamId.startsWith("ncaaf:") ? teamId.slice("ncaaf:".length) : teamId;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function mapEspnPosition(abbr: string | undefined, name?: string): AvailabilityPosition | undefined {
  const key = (abbr ?? "").toUpperCase();
  if (key === "QB") {
    return "qb";
  }
  if (key === "WR") {
    return "wr";
  }
  if (key === "DE" || key === "EDGE") {
    return "edge";
  }
  if (key === "OL" || key === "OT" || key === "OG" || key === "C" || key === "G" || key === "T" || key === "LT" || key === "RT" || key === "LG" || key === "RG") {
    return "ol";
  }
  const lower = (name ?? "").toLowerCase();
  if (lower.includes("quarterback")) {
    return "qb";
  }
  if (lower.includes("wide receiver")) {
    return "wr";
  }
  if (lower.includes("defensive end") || lower.includes("edge")) {
    return "edge";
  }
  if (lower.includes("offensive lineman") || lower.includes("tackle") || lower.includes("guard") || lower.includes("center")) {
    return "ol";
  }
  return undefined;
}

export function mapEspnStatus(raw: string | undefined): AvailabilityStatus | undefined {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "out" || key === "injured reserve" || key === "ir" || key === "suspended" || key === "inactive") {
    return "out";
  }
  if (key === "doubtful") {
    return "doubtful";
  }
  if (key === "questionable") {
    return "questionable";
  }
  if (key === "probable") {
    return "probable";
  }
  if (key === "active") {
    return "active";
  }
  return undefined;
}

export function espnInjuryIsFresh(injuryDateIso: string | undefined, kickoffIso: string, nowMs = Date.now()): boolean {
  if (!injuryDateIso) {
    return false;
  }
  const injuryMs = Date.parse(injuryDateIso);
  const kickMs = Date.parse(kickoffIso);
  if (!Number.isFinite(injuryMs) || !Number.isFinite(kickMs)) {
    return false;
  }
  if (injuryMs > nowMs + 24 * 60 * 60 * 1000) {
    return false;
  }
  return nowMs - injuryMs <= MAX_AGE_MS && kickMs - injuryMs <= MAX_AGE_MS + 2 * 24 * 60 * 60 * 1000;
}

function abbreviationFromGame(game: UpcomingGame, teamEspnId: string): string | undefined {
  if (espnTeamKey(game.home.id) === teamEspnId) {
    return game.home.abbreviation;
  }
  if (espnTeamKey(game.away.id) === teamEspnId) {
    return game.away.abbreviation;
  }
  return undefined;
}

function sideFromGame(game: UpcomingGame, teamEspnId: string): "home" | "away" | undefined {
  if (espnTeamKey(game.home.id) === teamEspnId) {
    return "home";
  }
  if (espnTeamKey(game.away.id) === teamEspnId) {
    return "away";
  }
  return undefined;
}

export function mapEspnInjuriesToItems(args: {
  payload: unknown;
  game: UpcomingGame;
  nowMs?: number;
}): AvailabilityItem[] {
  const root = asRecord(args.payload);
  const groups = root?.injuries;
  if (!Array.isArray(groups)) {
    return [];
  }
  const out: AvailabilityItem[] = [];
  for (const group of groups) {
    const rec = asRecord(group);
    if (!rec || typeof rec.id !== "string") {
      continue;
    }
    const side = sideFromGame(args.game, rec.id);
    const abbr = abbreviationFromGame(args.game, rec.id);
    if (!side || !abbr) {
      continue;
    }
    const rows = rec.injuries;
    if (!Array.isArray(rows)) {
      continue;
    }
    for (const row of rows) {
      const injury = asRecord(row);
      if (!injury) {
        continue;
      }
      const date = typeof injury.date === "string" ? injury.date : undefined;
      if (!espnInjuryIsFresh(date, args.game.kickoffIso, args.nowMs)) {
        continue;
      }
      const athlete = asRecord(injury.athlete);
      const position = asRecord(athlete?.position);
      const mappedPos = mapEspnPosition(
        typeof position?.abbreviation === "string" ? position.abbreviation : undefined,
        typeof position?.name === "string" ? position.name : undefined,
      );
      if (!mappedPos) {
        continue;
      }
      const status = mapEspnStatus(typeof injury.status === "string" ? injury.status : undefined);
      if (!status) {
        continue;
      }
      const player = typeof athlete?.displayName === "string" ? athlete.displayName : undefined;
      if (!player) {
        continue;
      }
      const source: AvailabilitySource = "conference-report";
      out.push({
        player,
        teamAbbreviation: abbr,
        side,
        positionGroup: mappedPos,
        status,
        sources: [source],
      });
    }
  }
  return out;
}

export function parseOperatorAvailabilityFile(payload: unknown): OperatorGameReport[] {
  const root = asRecord(payload);
  if (!root) {
    throw new Error("availability file must be an object");
  }
  if (root.reports === undefined) {
    throw new Error("availability file missing reports");
  }
  if (!Array.isArray(root.reports)) {
    throw new Error("availability file reports must be an array");
  }
  return root.reports.map((report, index) => {
    const rec = asRecord(report);
    if (!rec) {
      throw new Error(`reports[${index}] must be an object`);
    }
    if (rec.gameId !== undefined && (typeof rec.gameId !== "string" || rec.gameId.trim() === "")) {
      throw new Error(`reports[${index}].gameId must be a string`);
    }
    if (rec.homeAbbreviation !== undefined && typeof rec.homeAbbreviation !== "string") {
      throw new Error(`reports[${index}].homeAbbreviation must be a string`);
    }
    if (rec.awayAbbreviation !== undefined && typeof rec.awayAbbreviation !== "string") {
      throw new Error(`reports[${index}].awayAbbreviation must be a string`);
    }
    if (rec.kickoffDateKey !== undefined && typeof rec.kickoffDateKey !== "string") {
      throw new Error(`reports[${index}].kickoffDateKey must be a string`);
    }
    if (rec.items !== undefined && !Array.isArray(rec.items)) {
      throw new Error(`reports[${index}].items must be an array`);
    }
    return {
      gameId: typeof rec.gameId === "string" ? rec.gameId : undefined,
      homeAbbreviation: typeof rec.homeAbbreviation === "string" ? rec.homeAbbreviation : undefined,
      awayAbbreviation: typeof rec.awayAbbreviation === "string" ? rec.awayAbbreviation : undefined,
      kickoffDateKey: typeof rec.kickoffDateKey === "string" ? rec.kickoffDateKey : undefined,
      items: rec.items,
    };
  });
}

function kickoffDate(iso: string): string {
  return iso.slice(0, 10);
}

function operatorReportMatches(report: OperatorGameReport, game: UpcomingGame): boolean {
  if (report.gameId && report.gameId === game.id) {
    return true;
  }
  const home = report.homeAbbreviation?.toUpperCase();
  const away = report.awayAbbreviation?.toUpperCase();
  if (home && away) {
    const homeHit = game.home.abbreviation.toUpperCase() === home;
    const awayHit = game.away.abbreviation.toUpperCase() === away;
    if (!homeHit || !awayHit) {
      return false;
    }
    if (report.kickoffDateKey && kickoffDate(game.kickoffIso) !== report.kickoffDateKey) {
      return false;
    }
    return true;
  }
  return false;
}

function sideFromAbbreviation(game: UpcomingGame, abbreviation: string): "home" | "away" {
  const key = abbreviation.toUpperCase();
  if (game.home.abbreviation.toUpperCase() === key) {
    return "home";
  }
  if (game.away.abbreviation.toUpperCase() === key) {
    return "away";
  }
  throw new Error(`availability team ${abbreviation} is not in ${game.away.abbreviation} @ ${game.home.abbreviation}`);
}

export function itemsFromOperatorReport(report: OperatorGameReport, game: UpcomingGame): AvailabilityItem[] {
  const items = report.items ?? [];
  return items.map((raw, i) => {
    const rec = asRecord(raw) ?? {};
    const teamAbbreviation =
      typeof rec.teamAbbreviation === "string"
        ? rec.teamAbbreviation
        : undefined;
    if (!teamAbbreviation) {
      throw new Error(`reports item ${i} missing teamAbbreviation`);
    }
    const inferredSide = sideFromAbbreviation(game, teamAbbreviation);
    const side = typeof rec.side === "string" ? rec.side : inferredSide;
    if (side !== inferredSide) {
      throw new Error(`reports item ${i} side ${side} does not match ${teamAbbreviation}`);
    }
    return parseAvailabilityItem({ ...rec, teamAbbreviation, side });
  });
}

export async function loadOperatorAvailabilityReports(): Promise<OperatorGameReport[]> {
  const text = await readFile(OPERATOR_FILE, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (text === null) {
    return [];
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("data/availability.json is not valid JSON");
  }
  return parseOperatorAvailabilityFile(payload);
}

export async function fetchEspnInjuryPayload(): Promise<unknown> {
  return fetchEspnJson<EspnInjuriesPayload>(ESPN_INJURIES);
}

export async function loadNcaafAvailabilityItems(
  games: UpcomingGame[],
  options?: { nowMs?: number; espnPayload?: unknown; operatorReports?: OperatorGameReport[] },
): Promise<Map<string, AvailabilityItem[]>> {
  if (!Array.isArray(games)) {
    throw new Error("games must be an array");
  }
  const byGame = new Map<string, AvailabilityItem[]>();
  const operator = options?.operatorReports ?? (await loadOperatorAvailabilityReports());
  for (const game of games) {
    const items: AvailabilityItem[] = [];
    for (const report of operator) {
      if (operatorReportMatches(report, game)) {
        items.push(...itemsFromOperatorReport(report, game));
      }
    }
    byGame.set(game.id, items);
  }

  let espnPayload = options?.espnPayload;
  if (espnPayload === undefined) {
    try {
      espnPayload = await fetchEspnInjuryPayload();
    } catch (error) {
      console.warn(
        "ESPN NCAAF injuries unavailable:",
        error instanceof Error ? error.message : error,
      );
      return byGame;
    }
  }
  for (const game of games) {
    const espnItems = mapEspnInjuriesToItems({
      payload: espnPayload,
      game,
      nowMs: options?.nowMs,
    });
    const existing = byGame.get(game.id) ?? [];
    const seen = new Set(existing.map((item) => `${item.side}:${item.player.toLowerCase()}`));
    for (const item of espnItems) {
      const key = `${item.side}:${item.player.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      existing.push(item);
      seen.add(key);
    }
    byGame.set(game.id, existing);
  }
  return byGame;
}
