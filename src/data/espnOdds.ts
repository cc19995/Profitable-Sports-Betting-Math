import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CompletedGame, MarketLines, UpcomingGame } from "@/src/lib/types";
import { fetchEspnJson } from "./espn";

const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

type OddsCache = Record<string, MarketLines | null>;

function cachePath(): string {
  return path.join(process.cwd(), "data", "cache", "espn-ncaaf-core-odds.json");
}

function espnEventId(gameId: string): string | undefined {
  const match = /^ncaaf:(\d+)$/.exec(gameId);
  return match?.[1];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseAmericanish(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const cleaned = raw.trim().replace(/^\+/, "");
  if (cleaned === "" || cleaned.toLowerCase() === "even") {
    return cleaned.toLowerCase() === "even" ? 100 : undefined;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function parseLineish(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const n = Number(raw.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function nestedAmerican(obj: unknown, ...pathParts: string[]): number | undefined {
  let cur: unknown = obj;
  for (const key of pathParts) {
    const rec = asRecord(cur);
    if (!rec) {
      return undefined;
    }
    cur = rec[key];
  }
  const rec = asRecord(cur);
  return parseAmericanish(rec?.american ?? rec?.alternateDisplayValue ?? cur);
}

function nestedLine(obj: unknown, ...pathParts: string[]): number | undefined {
  let cur: unknown = obj;
  for (const key of pathParts) {
    const rec = asRecord(cur);
    if (!rec) {
      return undefined;
    }
    cur = rec[key];
  }
  const rec = asRecord(cur);
  return parseLineish(rec?.american ?? rec?.alternateDisplayValue ?? rec?.value ?? cur);
}

export function marketFromEspnCoreOdds(payload: unknown): MarketLines | undefined {
  const root = asRecord(payload);
  const items = root?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const row = asRecord(items[0]);
  if (!row) {
    return undefined;
  }
  const provider = asRecord(row.provider);
  const home = row.homeTeamOdds;
  const away = row.awayTeamOdds;
  const homeSpread =
    nestedLine(home, "close", "pointSpread") ??
    nestedLine(home, "current", "pointSpread") ??
    parseLineish(row.spread);
  const total =
    nestedLine(row, "close", "overUnder") ??
    parseLineish(row.overUnder);
  const market: MarketLines = {
    book: typeof provider?.name === "string" ? provider.name : "ESPN BET",
    homeMoneyline:
      nestedAmerican(home, "close", "moneyLine") ?? parseAmericanish(asRecord(home)?.moneyLine),
    awayMoneyline:
      nestedAmerican(away, "close", "moneyLine") ?? parseAmericanish(asRecord(away)?.moneyLine),
    homeSpread,
    homeSpreadOdds:
      nestedAmerican(home, "close", "spread") ?? parseAmericanish(asRecord(home)?.spreadOdds),
    awaySpreadOdds:
      nestedAmerican(away, "close", "spread") ?? parseAmericanish(asRecord(away)?.spreadOdds),
    total,
    overOdds: parseAmericanish(row.overOdds),
    underOdds: parseAmericanish(row.underOdds),
    openHomeSpread: nestedLine(home, "open", "pointSpread"),
    openTotal: nestedLine(row, "open", "overUnder"),
    openHomeMoneyline: nestedAmerican(home, "open", "moneyLine"),
    openAwayMoneyline: nestedAmerican(away, "open", "moneyLine"),
  };
  if (
    market.homeSpread === undefined &&
    market.total === undefined &&
    market.homeMoneyline === undefined &&
    market.awayMoneyline === undefined
  ) {
    return undefined;
  }
  return market;
}

async function loadCache(): Promise<OddsCache> {
  try {
    const raw = await readFile(cachePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return asRecord(parsed) as OddsCache;
  } catch {
    return {};
  }
}

async function saveCache(cache: OddsCache): Promise<void> {
  const file = cachePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cache));
}

export async function fetchEspnCoreOdds(eventId: string): Promise<MarketLines | undefined> {
  const url = `${CORE}/events/${eventId}/competitions/${eventId}/odds`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const payload = await fetchEspnJson<unknown>(url);
      return marketFromEspnCoreOdds(payload);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(slice.map(fn))));
  }
  return results;
}

export async function attachHistoricalClosingOdds<T extends CompletedGame | UpcomingGame>(
  games: T[],
  options?: { concurrency?: number },
): Promise<T[]> {
  const concurrency = options?.concurrency ?? 6;
  const cache = await loadCache();
  const missing = games.filter((game) => {
    const id = espnEventId(game.id);
    return id !== undefined && cache[id] === undefined;
  });
  await mapLimited(missing, concurrency, async (game) => {
    const id = espnEventId(game.id);
    if (!id) {
      return;
    }
    try {
      cache[id] = (await fetchEspnCoreOdds(id)) ?? null;
    } catch (error) {
      console.warn(
        "ESPN core odds unavailable:",
        id,
        error instanceof Error ? error.message : error,
      );
      cache[id] = null;
    }
  });
  if (missing.length > 0) {
    await saveCache(cache);
  }
  return games.map((game) => {
    const id = espnEventId(game.id);
    if (!id) {
      return game;
    }
    const market = cache[id];
    if (!market) {
      return game;
    }
    return { ...game, market };
  });
}
