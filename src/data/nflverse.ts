import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { CompletedGame, MarketLines, UpcomingGame } from "@/src/lib/types";

const NFLVERSE_GAMES_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";

function cachePath(): string {
  return path.join(process.cwd(), "data", "cache", "nflverse-games.csv");
}

async function ensureGamesCsv(): Promise<string> {
  const dest = cachePath();
  await mkdir(path.dirname(dest), { recursive: true });
  const existing = await stat(dest).catch(() => null);
  const freshEnough = existing && Date.now() - existing.mtimeMs < 12 * 60 * 60 * 1000;
  if (freshEnough) {
    return dest;
  }
  const response = await fetch(NFLVERSE_GAMES_URL, { headers: { Accept: "text/csv" } });
  if (!response.ok) {
    if (existing) {
      return dest;
    }
    throw new Error(`nflverse download failed: ${response.status}`);
  }
  const text = await response.text();
  await writeFile(dest, text);
  return dest;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function team(abbreviation: string): { id: string; abbreviation: string; name: string } {
  return { id: `nfl:${abbreviation}`, abbreviation, name: abbreviation };
}

export async function loadNflverseGames(seasons: number[]): Promise<Array<CompletedGame | UpcomingGame>> {
  if (seasons.length === 0) {
    throw new Error("seasons is required");
  }
  const wanted = new Set(seasons);
  const file = await ensureGamesCsv();
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header: string[] | null = null;
  const games: Array<CompletedGame | UpcomingGame> = [];

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    const cols = parseCsvLine(line);
    const row = Object.fromEntries(header.map((key, i) => [key, cols[i] ?? ""]));
    const season = Number(row.season);
    if (!wanted.has(season)) {
      continue;
    }
    const gameType = row.game_type || "REG";
    if (!["REG", "WC", "DIV", "CON", "SB"].includes(gameType)) {
      continue;
    }
    const home = row.home_team;
    const away = row.away_team;
    if (!home || !away) {
      continue;
    }
    const spreadLine = num(row.spread_line);
    const market: MarketLines = {
      book: "nflverse-close",
      homeMoneyline: num(row.home_moneyline),
      awayMoneyline: num(row.away_moneyline),
      // nflverse spread_line > 0 means home favored. Posted home line is the opposite sign.
      homeSpread: spreadLine !== undefined ? -spreadLine : undefined,
      homeSpreadOdds: num(row.home_spread_odds),
      awaySpreadOdds: num(row.away_spread_odds),
      total: num(row.total_line),
      overOdds: num(row.over_odds),
      underOdds: num(row.under_odds),
    };

    const base = {
      id: `nfl:${row.game_id || `${season}-${row.week}-${away}-${home}`}`,
      league: "nfl" as const,
      season,
      week: Number(row.week) || 0,
      gameType: row.game_type || "REG",
      kickoffIso: row.gameday ? `${row.gameday}T${row.gametime || "13:00"}:00Z` : new Date().toISOString(),
      home: team(home),
      away: team(away),
      neutralSite: row.location === "Neutral",
      homeRestDays: num(row.home_rest),
      awayRestDays: num(row.away_rest),
      roof: row.roof,
      temperatureF: num(row.temp),
      windMph: num(row.wind),
      market,
    };
    const homeScore = num(row.home_score);
    const awayScore = num(row.away_score);
    if (homeScore !== undefined && awayScore !== undefined) {
      games.push({ ...base, homeScore, awayScore });
    } else {
      games.push(base);
    }
  }
  return games;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
