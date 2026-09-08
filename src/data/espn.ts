import type { CompletedGame, League, MarketLines, TeamRef, UpcomingGame } from "@/src/lib/types";

const ESPN_SITE_HOSTS = [
  "https://site.web.api.espn.com",
  "https://site.api.espn.com",
] as const;

const ESPN_HEADERS = {
  Accept: "application/json",
  "User-Agent": "football-ev-desk/1.0",
} as const;

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  winner?: boolean;
  records?: Array<{ type?: string; summary?: string }>;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    name?: string;
    conferenceId?: string;
  };
}

interface EspnOdds {
  provider?: { name?: string };
  details?: string;
  overUnder?: number;
  spread?: number;
  moneyline?: {
    home?: { close?: { odds?: string }; open?: { odds?: string } };
    away?: { close?: { odds?: string }; open?: { odds?: string } };
  };
  pointSpread?: {
    home?: { close?: { line?: string; odds?: string }; open?: { line?: string } };
    away?: { close?: { odds?: string } };
  };
  total?: {
    over?: { close?: { line?: string; odds?: string }; open?: { line?: string } };
    under?: { close?: { odds?: string } };
  };
  homeTeamOdds?: { favorite?: boolean };
  awayTeamOdds?: { favorite?: boolean };
}

interface EspnEvent {
  id?: string;
  date?: string;
  name?: string;
  season?: { year?: number };
  week?: { number?: number };
  competitions?: Array<{
    id?: string;
    date?: string;
    neutralSite?: boolean;
    competitors?: EspnCompetitor[];
    status?: { type?: { completed?: boolean; state?: string; name?: string } };
    venue?: {
      fullName?: string;
      indoor?: boolean;
      address?: { city?: string; state?: string; country?: string };
    };
    weather?: { temperature?: number; displayValue?: string; gust?: number; conditionId?: string };
    odds?: EspnOdds[];
  }>;
}

interface EspnScoreboard {
  events?: EspnEvent[];
  season?: { year?: number; type?: number };
  week?: { number?: number };
}

function leaguePath(league: League): string {
  return league === "nfl" ? "nfl" : "college-football";
}

function expandEspnUrls(url: string): string[] {
  if (url.includes("site.api.espn.com")) {
    return [url, url.replace("site.api.espn.com", "site.web.api.espn.com")];
  }
  if (url.includes("site.web.api.espn.com")) {
    return [url, url.replace("site.web.api.espn.com", "site.api.espn.com")];
  }
  return [url];
}

export async function fetchEspnJson<T>(url: string): Promise<T> {
  let lastError: Error | undefined;
  for (const candidate of expandEspnUrls(url)) {
    try {
      const response = await fetch(candidate, {
        headers: ESPN_HEADERS,
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      lastError = new Error(`ESPN request failed ${response.status} for ${candidate}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`ESPN request failed for ${url}`);
}

export async function cachedEspnJson<T>(args: {
  url: string;
  fileName: string;
  ttlMs?: number;
}): Promise<T> {
  if (typeof args.url !== "string" || args.url.length === 0) {
    throw new Error("espn url is required");
  }
  if (typeof args.fileName !== "string" || args.fileName.length === 0) {
    throw new Error("espn fileName is required");
  }
  const { mkdir, readFile, stat, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dest = path.join(process.cwd(), "data", "cache", args.fileName);
  await mkdir(path.dirname(dest), { recursive: true });
  const existing = await stat(dest).catch(() => null);
  const ttl = args.ttlMs ?? 2 * 60 * 60 * 1000;
  if (existing && Date.now() - existing.mtimeMs < ttl) {
    return JSON.parse(await readFile(dest, "utf8")) as T;
  }
  try {
    const payload = await fetchEspnJson<T>(args.url);
    await writeFile(dest, JSON.stringify(payload));
    return payload;
  } catch (error) {
    if (existing) {
      return JSON.parse(await readFile(dest, "utf8")) as T;
    }
    throw error;
  }
}

export function espnSitePath(league: League, suffix: string): string {
  return `${ESPN_SITE_HOSTS[0]}/apis/site/v2/sports/football/${leaguePath(league)}/${suffix}`;
}

function parseAmerican(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.trim().replace(/^\+/, "");
  if (cleaned === "" || cleaned === "EVEN" || cleaned === "even") {
    return cleaned.toLowerCase() === "even" ? 100 : undefined;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function parseLine(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const n = Number(raw.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function teamRef(competitor: EspnCompetitor, league: League): TeamRef {
  const id = competitor.team?.id;
  const abbreviation = competitor.team?.abbreviation;
  const name = competitor.team?.displayName ?? competitor.team?.name;
  if (!id || !abbreviation || !name) {
    throw new Error("ESPN competitor is missing team identity");
  }
  return {
    id: league === "nfl" ? `nfl:${abbreviation}` : `${league}:${id}`,
    abbreviation,
    name,
  };
}

function extractMarket(odds: EspnOdds[] | undefined): MarketLines | undefined {
  if (!odds || odds.length === 0) {
    return undefined;
  }
  const row = odds[0];
  if (!row) {
    return undefined;
  }
  const homeSpread = parseLine(row.pointSpread?.home?.close?.line) ?? row.spread;
  const total = parseLine(row.total?.over?.close?.line) ?? row.overUnder;
  return {
    book: row.provider?.name,
    homeMoneyline: parseAmerican(row.moneyline?.home?.close?.odds),
    awayMoneyline: parseAmerican(row.moneyline?.away?.close?.odds),
    homeSpread,
    homeSpreadOdds: parseAmerican(row.pointSpread?.home?.close?.odds),
    awaySpreadOdds: parseAmerican(row.pointSpread?.away?.close?.odds),
    total,
    overOdds: parseAmerican(row.total?.over?.close?.odds),
    underOdds: parseAmerican(row.total?.under?.close?.odds),
    openHomeSpread: parseLine(row.pointSpread?.home?.open?.line),
    openTotal: parseLine(row.total?.over?.open?.line),
    openHomeMoneyline: parseAmerican(row.moneyline?.home?.open?.odds),
    openAwayMoneyline: parseAmerican(row.moneyline?.away?.open?.odds),
  };
}

function recordSummary(competitor: EspnCompetitor): string | undefined {
  return competitor.records?.find((r) => r.type === "total")?.summary;
}

function mapEvent(event: EspnEvent, league: League): CompletedGame | UpcomingGame | null {
  const competition = event.competitions?.[0];
  if (!competition || !event.id || !event.date) {
    return null;
  }
  const homeC = competition.competitors?.find((c) => c.homeAway === "home");
  const awayC = competition.competitors?.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) {
    return null;
  }
  let home: TeamRef;
  let away: TeamRef;
  try {
    home = teamRef(homeC, league);
    away = teamRef(awayC, league);
  } catch {
    return null;
  }
  const completed = Boolean(competition.status?.type?.completed);
  const base = {
    id: `${league}:${event.id}`,
    league,
    season: event.season?.year ?? 0,
    week: event.week?.number ?? 0,
    gameType: "REG",
    kickoffIso: competition.date ?? event.date,
    home,
    away,
    neutralSite: Boolean(competition.neutralSite),
    venueName: competition.venue?.fullName,
    venueCity: competition.venue?.address?.city,
    venueState: competition.venue?.address?.state,
    indoor: competition.venue?.indoor,
    roof: competition.venue?.indoor ? "dome" : "outdoors",
    temperatureF: competition.weather?.temperature,
    market: extractMarket(competition.odds),
    homeRecord: recordSummary(homeC),
    awayRecord: recordSummary(awayC),
  };
  if (completed) {
    const homeScore = Number(homeC.score);
    const awayScore = Number(awayC.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      return null;
    }
    return {
      ...base,
      homeScore,
      awayScore,
    };
  }
  return base;
}

export async function fetchEspnScoreboard(args: {
  league: League;
  dates?: string;
  week?: number;
  seasonType?: number;
  year?: number;
  limit?: number;
}): Promise<Array<CompletedGame | UpcomingGame>> {
  const search = new URLSearchParams();
  if (args.dates) {
    search.set("dates", args.dates);
  }
  if (args.week !== undefined) {
    search.set("week", String(args.week));
  }
  if (args.seasonType !== undefined) {
    search.set("seasontype", String(args.seasonType));
  }
  if (args.year !== undefined) {
    search.set("dates", String(args.year));
  }
  search.set("limit", String(args.limit ?? 300));
  if (args.league === "ncaaf") {
    search.set("groups", "80");
  }
  const url = espnSitePath(args.league, `scoreboard?${search.toString()}`);
  const payload = await fetchEspnJson<EspnScoreboard>(url);
  const out: Array<CompletedGame | UpcomingGame> = [];
  for (const event of payload.events ?? []) {
    const mapped = mapEvent(event, args.league);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

export function isCompletedGame(game: CompletedGame | UpcomingGame): game is CompletedGame {
  return "homeScore" in game && "awayScore" in game;
}

export async function fetchEspnSeason(args: {
  league: League;
  year: number;
  maxWeek?: number;
  includePostseason?: boolean;
}): Promise<Array<CompletedGame | UpcomingGame>> {
  const maxWeek = args.maxWeek ?? (args.league === "nfl" ? 18 : 15);
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const regular = await mapLimited(weeks, 4, (week) =>
    fetchEspnScoreboard({
      league: args.league,
      week,
      seasonType: 2,
      year: args.year,
    }),
  );
  const merged = regular.flat();
  if (args.includePostseason) {
    const postWeeks = args.league === "nfl" ? [1, 2, 3, 4, 5] : [1];
    const post = await mapLimited(postWeeks, 3, (week) =>
      fetchEspnScoreboard({
        league: args.league,
        week,
        seasonType: 3,
        year: args.year,
      }),
    );
    merged.push(...post.flat());
  }
  return dedupeGames(merged);
}

async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(slice.map(fn))));
  }
  return results;
}

export function dedupeGames<T extends { id: string }>(games: T[]): T[] {
  const map = new Map<string, T>();
  for (const game of games) {
    map.set(game.id, game);
  }
  return [...map.values()];
}

export function attachRestDays<T extends UpcomingGame | CompletedGame>(games: T[]): T[] {
  const sorted = games.slice().sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));
  const lastDate = new Map<string, string>();
  for (const game of sorted) {
    const homePrev = lastDate.get(game.home.id);
    const awayPrev = lastDate.get(game.away.id);
    if (homePrev) {
      game.homeRestDays = dayDiff(homePrev, game.kickoffIso);
    }
    if (awayPrev) {
      game.awayRestDays = dayDiff(awayPrev, game.kickoffIso);
    }
    lastDate.set(game.home.id, game.kickoffIso);
    lastDate.set(game.away.id, game.kickoffIso);
  }
  return games;
}

function dayDiff(prevIso: string, nextIso: string): number {
  const prev = Date.parse(prevIso);
  const next = Date.parse(nextIso);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || next < prev) {
    return 7;
  }
  return Math.max(1, Math.round((next - prev) / 86_400_000));
}
