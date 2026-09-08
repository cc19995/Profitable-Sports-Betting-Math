import { cachedJson } from "./httpCache";
import { cachedEspnJson, espnSitePath } from "./espn";
import {
  buildGameEdgeContext,
  tagNewsText,
  weatherFromForecast,
  type ParsedInjury,
} from "@/src/lib/weeklyEdge";
import type {
  League,
  MarketBookLine,
  NewsItem,
  TeamRef,
  UpcomingGame,
  WeatherForecast,
} from "@/src/lib/types";

const INJURY_TTL_MS = 2 * 60 * 60 * 1000;
const NEWS_TTL_MS = 2 * 60 * 60 * 1000;
const MARKET_TTL_MS = 45 * 60 * 1000;
const WEATHER_TTL_MS = 6 * 60 * 60 * 1000;
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ACTION_BOOK_NAMES: Record<number, string> = {
  15: "DraftKings",
  30: "FanDuel",
  68: "Caesars",
  69: "BetMGM",
  71: "PointsBet",
  75: "BetRivers",
  79: "Circa",
  123: "Pinnacle",
};

const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

export interface InjuryIndex {
  byTeamId: Map<string, ParsedInjury[]>;
  byAbbr: Map<string, ParsedInjury[]>;
  byName: Map<string, ParsedInjury[]>;
}

interface EspnInjuryAthlete {
  displayName?: string;
  position?: { abbreviation?: string };
  team?: { id?: string; abbreviation?: string; displayName?: string };
}

interface EspnInjuryRow {
  status?: string;
  shortComment?: string;
  longComment?: string;
  athlete?: EspnInjuryAthlete;
}

interface EspnInjuryTeam {
  id?: string;
  displayName?: string;
  injuries?: EspnInjuryRow[];
}

interface EspnInjuryPayload {
  injuries?: EspnInjuryTeam[];
}

interface EspnNewsCategory {
  team?: { abbreviation?: string };
}

interface EspnNewsArticle {
  headline?: string;
  description?: string;
  published?: string;
  links?: { web?: { href?: string } };
  categories?: EspnNewsCategory[];
}

interface EspnNewsPayload {
  articles?: EspnNewsArticle[];
}

interface ActionTeam {
  id?: number;
  abbr?: string;
  full_name?: string;
}

interface ActionOdds {
  book_id?: number;
  type?: string;
  inserted?: string;
  spread_home?: number;
  total?: number;
  ml_home?: number;
  ml_away?: number;
}

interface ActionGame {
  start_time?: string;
  home_team_id?: number;
  away_team_id?: number;
  teams?: ActionTeam[];
  odds?: ActionOdds[];
}

interface ActionScoreboard {
  games?: ActionGame[];
}

interface GeocodeHit {
  latitude?: number;
  longitude?: number;
  admin1?: string;
  country_code?: string;
}

interface GeocodePayload {
  results?: GeocodeHit[];
}

interface HourlyWeather {
  time?: string[];
  temperature_2m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  precipitation?: Array<number | null>;
  snowfall?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
}

function pushIndex(map: Map<string, ParsedInjury[]>, key: string | undefined, row: ParsedInjury): void {
  if (!key) {
    return;
  }
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const list = map.get(normalized) ?? [];
  list.push(row);
  map.set(normalized, list);
}

export function parseInjuryPayload(league: League, payload: EspnInjuryPayload): InjuryIndex {
  const index: InjuryIndex = {
    byTeamId: new Map(),
    byAbbr: new Map(),
    byName: new Map(),
  };
  for (const team of payload.injuries ?? []) {
    for (const row of team.injuries ?? []) {
      const player = row.athlete?.displayName;
      if (!player) {
        continue;
      }
      const abbr = row.athlete?.team?.abbreviation;
      const espnTeamId = row.athlete?.team?.id ?? team.id;
      const parsed: ParsedInjury = {
        player,
        position: row.athlete?.position?.abbreviation ?? "?",
        status: row.status ?? "other",
        comment: row.shortComment ?? row.longComment,
        teamAbbr: abbr,
        espnTeamId,
        teamName: row.athlete?.team?.displayName ?? team.displayName,
      };
      const teamId =
        league === "nfl" ? (abbr ? `nfl:${abbr}` : undefined) : espnTeamId ? `ncaaf:${espnTeamId}` : undefined;
      pushIndex(index.byTeamId, teamId, parsed);
      pushIndex(index.byAbbr, abbr, parsed);
      pushIndex(index.byName, parsed.teamName, parsed);
      pushIndex(index.byName, team.displayName, parsed);
    }
  }
  return index;
}

export function lookupInjuries(index: InjuryIndex, team: TeamRef): ParsedInjury[] {
  return (
    index.byTeamId.get(team.id.toLowerCase()) ??
    index.byAbbr.get(team.abbreviation.toLowerCase()) ??
    index.byName.get(team.name.toLowerCase()) ??
    []
  );
}

export function emptyInjuryIndex(): InjuryIndex {
  return { byTeamId: new Map(), byAbbr: new Map(), byName: new Map() };
}

export async function fetchInjuryIndex(league: League): Promise<InjuryIndex> {
  const payload = await cachedEspnJson<EspnInjuryPayload>({
    url: espnSitePath(league, "injuries"),
    fileName: `espn-${league}-injuries.json`,
    ttlMs: INJURY_TTL_MS,
  });
  return parseInjuryPayload(league, payload);
}

export function parseNewsPayload(payload: EspnNewsPayload): NewsItem[] {
  const items: NewsItem[] = [];
  for (const article of payload.articles ?? []) {
    if (!article.headline) {
      continue;
    }
    const text = `${article.headline} ${article.description ?? ""}`;
    const teamAbbrs = [
      ...new Set(
        (article.categories ?? [])
          .map((category) => category.team?.abbreviation)
          .filter((abbr): abbr is string => typeof abbr === "string" && abbr.length > 0),
      ),
    ];
    items.push({
      headline: article.headline,
      published: article.published,
      url: article.links?.web?.href,
      teamAbbrs,
      tags: tagNewsText(text),
    });
  }
  return items;
}

export async function fetchLeagueNews(league: League): Promise<NewsItem[]> {
  const payload = await cachedEspnJson<EspnNewsPayload>({
    url: espnSitePath(league, "news?limit=50"),
    fileName: `espn-${league}-news.json`,
    ttlMs: NEWS_TTL_MS,
  });
  return parseNewsPayload(payload);
}

function actionTeam(game: ActionGame, teamId: number | undefined): ActionTeam | undefined {
  return game.teams?.find((team) => team.id === teamId);
}

export function parseActionGame(game: ActionGame): {
  homeAbbr?: string;
  awayAbbr?: string;
  kickoffIso?: string;
  books: MarketBookLine[];
} {
  const home = actionTeam(game, game.home_team_id);
  const away = actionTeam(game, game.away_team_id);
  const books: MarketBookLine[] = [];
  for (const row of game.odds ?? []) {
    if (row.type && row.type !== "game") {
      continue;
    }
    if (row.book_id === undefined) {
      continue;
    }
    books.push({
      bookId: row.book_id,
      book: ACTION_BOOK_NAMES[row.book_id] ?? `book:${row.book_id}`,
      homeSpread: row.spread_home,
      total: row.total,
      homeMoneyline: row.ml_home,
      awayMoneyline: row.ml_away,
      updatedIso: row.inserted,
    });
  }
  return {
    homeAbbr: home?.abbr,
    awayAbbr: away?.abbr,
    kickoffIso: game.start_time,
    books,
  };
}

export async function fetchActionBooks(league: League): Promise<
  Array<{ homeAbbr?: string; awayAbbr?: string; kickoffIso?: string; books: MarketBookLine[] }>
> {
  const path = league === "nfl" ? "nfl" : "ncaaf";
  const payload = await cachedJson<ActionScoreboard>({
    url: `https://api.actionnetwork.com/web/v1/scoreboard/${path}?period=game&bookIds=15,30,75,68,69,79`,
    fileName: `action-${league}-scoreboard.json`,
    ttlMs: MARKET_TTL_MS,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return (payload.games ?? []).map(parseActionGame);
}

function sameKickoffDay(left?: string, right?: string): boolean {
  if (!left || !right) {
    return true;
  }
  return left.slice(0, 10) === right.slice(0, 10);
}

export function matchActionBooks(
  rows: Array<{ homeAbbr?: string; awayAbbr?: string; kickoffIso?: string; books: MarketBookLine[] }>,
  game: UpcomingGame,
): MarketBookLine[] {
  const home = game.home.abbreviation.toUpperCase();
  const away = game.away.abbreviation.toUpperCase();
  const hit = rows.find(
    (row) =>
      row.homeAbbr?.toUpperCase() === home &&
      row.awayAbbr?.toUpperCase() === away &&
      sameKickoffDay(row.kickoffIso, game.kickoffIso),
  );
  return hit?.books ?? [];
}

function stateName(state?: string): string | undefined {
  if (!state) {
    return undefined;
  }
  const upper = state.toUpperCase();
  return US_STATES[upper] ?? state;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function geocodeVenue(city: string, state?: string): Promise<{ lat: number; lon: number } | undefined> {
  if (typeof city !== "string" || city.trim().length === 0) {
    throw new Error("city is required");
  }
  const query = new URLSearchParams({
    name: city.trim(),
    count: "5",
    language: "en",
    format: "json",
    country: "US",
  });
  const payload = await cachedJson<GeocodePayload>({
    url: `https://geocoding-api.open-meteo.com/v1/search?${query.toString()}`,
    fileName: `geocode-${slug(`${city}-${state ?? ""}`)}.json`,
    ttlMs: GEOCODE_TTL_MS,
  });
  const want = stateName(state)?.toLowerCase();
  const hits = payload.results ?? [];
  const match =
    (want ? hits.find((hit) => hit.admin1?.toLowerCase() === want) : undefined) ??
    hits.find((hit) => hit.country_code === "US") ??
    hits[0];
  if (match?.latitude === undefined || match.longitude === undefined) {
    return undefined;
  }
  return { lat: match.latitude, lon: match.longitude };
}

function closestHourIndex(times: string[], kickoffIso: string): number {
  const target = Date.parse(kickoffIso);
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const stamp = times[i];
    if (!stamp) {
      continue;
    }
    const parsed = Date.parse(stamp.endsWith("Z") || stamp.includes("+") ? stamp : `${stamp}:00Z`);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const delta = Math.abs(parsed - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

export async function forecastKickoff(args: {
  lat: number;
  lon: number;
  kickoffIso: string;
  indoor?: boolean;
  roof?: string;
  city?: string;
  state?: string;
}): Promise<WeatherForecast> {
  if (args.indoor || args.roof === "dome" || args.roof === "closed") {
    return weatherFromForecast({
      indoor: true,
      roof: args.roof,
      city: args.city,
      state: args.state,
      source: "none",
    });
  }
  const query = new URLSearchParams({
    latitude: String(args.lat),
    longitude: String(args.lon),
    hourly: "temperature_2m,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,relative_humidity_2m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "UTC",
    forecast_days: "16",
  });
  const payload = await cachedJson<{ hourly?: HourlyWeather }>({
    url: `https://api.open-meteo.com/v1/forecast?${query.toString()}`,
    fileName: `weather-${args.lat.toFixed(2)}-${args.lon.toFixed(2)}.json`,
    ttlMs: WEATHER_TTL_MS,
  });
  const hourly = payload.hourly;
  const times = hourly?.time ?? [];
  if (times.length === 0) {
    return weatherFromForecast({
      indoor: false,
      roof: args.roof,
      city: args.city,
      state: args.state,
      source: "none",
    });
  }
  const idx = closestHourIndex(times, args.kickoffIso);
  const num = (series: Array<number | null> | undefined): number | undefined => {
    const value = series?.[idx];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  return weatherFromForecast({
    indoor: false,
    roof: args.roof,
    city: args.city,
    state: args.state,
    temperatureF: num(hourly?.temperature_2m),
    windMph: num(hourly?.wind_speed_10m),
    windGustMph: num(hourly?.wind_gusts_10m),
    precipProbability: num(hourly?.precipitation_probability),
    precipMm: num(hourly?.precipitation),
    snowfallCm: num(hourly?.snowfall),
    humidity: num(hourly?.relative_humidity_2m),
    source: "open-meteo",
  });
}

async function weatherForGame(game: UpcomingGame): Promise<WeatherForecast> {
  if (game.indoor || game.roof === "dome" || game.roof === "closed") {
    return weatherFromForecast({
      indoor: true,
      roof: game.roof,
      city: game.venueCity,
      state: game.venueState,
      source: "none",
    });
  }
  const city = game.venueCity;
  if (!city) {
    return weatherFromForecast({
      indoor: false,
      roof: game.roof,
      city: game.venueCity,
      state: game.venueState,
      windMph: game.windMph,
      temperatureF: game.temperatureF,
      source: "none",
    });
  }
  try {
    const coords = await geocodeVenue(city, game.venueState);
    if (!coords) {
      return weatherFromForecast({
        indoor: false,
        roof: game.roof,
        city,
        state: game.venueState,
        source: "none",
      });
    }
    return await forecastKickoff({
      lat: coords.lat,
      lon: coords.lon,
      kickoffIso: game.kickoffIso,
      indoor: game.indoor,
      roof: game.roof,
      city,
      state: game.venueState,
    });
  } catch (error) {
    console.warn("weather lookup failed:", city, error instanceof Error ? error.message : error);
    return weatherFromForecast({
      indoor: Boolean(game.indoor),
      roof: game.roof,
      city,
      state: game.venueState,
      source: "none",
    });
  }
}

export interface WeeklyFeeds {
  injuries: Record<League, InjuryIndex>;
  news: Record<League, NewsItem[]>;
  books: Record<League, Array<{ homeAbbr?: string; awayAbbr?: string; kickoffIso?: string; books: MarketBookLine[] }>>;
}

export async function loadWeeklyFeeds(leagues: League[]): Promise<WeeklyFeeds> {
  const unique = [...new Set(leagues)];
  const injuries: Record<League, InjuryIndex> = {
    nfl: emptyInjuryIndex(),
    ncaaf: emptyInjuryIndex(),
  };
  const news: Record<League, NewsItem[]> = { nfl: [], ncaaf: [] };
  const books: WeeklyFeeds["books"] = { nfl: [], ncaaf: [] };
  await Promise.all(
    unique.map(async (league) => {
      const [inj, headlines, market] = await Promise.all([
        fetchInjuryIndex(league).catch((error: unknown) => {
          console.warn(`${league} injuries unavailable:`, error instanceof Error ? error.message : error);
          return emptyInjuryIndex();
        }),
        fetchLeagueNews(league).catch((error: unknown) => {
          console.warn(`${league} news unavailable:`, error instanceof Error ? error.message : error);
          return [] as NewsItem[];
        }),
        fetchActionBooks(league).catch((error: unknown) => {
          console.warn(`${league} Action Network unavailable:`, error instanceof Error ? error.message : error);
          return [];
        }),
      ]);
      injuries[league] = inj;
      news[league] = headlines;
      books[league] = market;
    }),
  );
  return { injuries, news, books };
}

export async function attachWeeklyEdge(games: UpcomingGame[]): Promise<UpcomingGame[]> {
  if (games.length === 0) {
    return games;
  }
  const feeds = await loadWeeklyFeeds([...new Set(games.map((game) => game.league))]);
  const weatherCache = new Map<string, Promise<WeatherForecast>>();
  const attached = await Promise.all(
    games.map(async (game) => {
      const key = `${game.indoor ? "in" : "out"}:${game.venueCity ?? ""}:${game.venueState ?? ""}:${game.kickoffIso.slice(0, 13)}`;
      let weatherPromise = weatherCache.get(key);
      if (!weatherPromise) {
        weatherPromise = weatherForGame(game);
        weatherCache.set(key, weatherPromise);
      }
      const weather = await weatherPromise;
      const edge = buildGameEdgeContext({
        game,
        homeInjuries: lookupInjuries(feeds.injuries[game.league], game.home),
        awayInjuries: lookupInjuries(feeds.injuries[game.league], game.away),
        weather,
        books: matchActionBooks(feeds.books[game.league], game),
        news: feeds.news[game.league],
      });
      return {
        ...game,
        temperatureF: weather.temperatureF ?? game.temperatureF,
        windMph: weather.windMph ?? game.windMph,
        edge,
      };
    }),
  );
  return attached;
}

export function compactGameEdge(game: UpcomingGame): Record<string, unknown> {
  const edge = game.edge;
  return {
    id: game.id,
    league: game.league,
    matchup: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
    kickoffIso: game.kickoffIso,
    venue: [game.venueName, game.venueCity, game.venueState].filter(Boolean).join(", "),
    indoor: Boolean(game.indoor),
    espnSpread: game.market?.homeSpread,
    espnTotal: game.market?.total,
    espnSpreadOpen: game.market?.openHomeSpread,
    notes: edge?.notes ?? [],
    qbHome: edge?.scoreAdjustments.qbHome ?? 0,
    qbAway: edge?.scoreAdjustments.qbAway ?? 0,
    injuryHome: edge?.scoreAdjustments.injuryHome ?? 0,
    injuryAway: edge?.scoreAdjustments.injuryAway ?? 0,
    weatherTotal: edge?.scoreAdjustments.weatherTotal ?? 0,
    weather: edge?.weather.description,
    windMph: edge?.weather.windMph ?? game.windMph,
    consensusSpread: edge?.market.consensusHomeSpread,
    consensusTotal: edge?.market.consensusTotal,
    spreadMove: edge?.market.espnSpreadMove,
    books: edge?.market.books.length ?? 0,
    news: (edge?.news ?? []).slice(0, 3).map((item) => item.headline),
    notableInjuries: [
      ...(edge?.injuries.home.listings ?? []),
      ...(edge?.injuries.away.listings ?? []),
    ]
      .filter((row) => row.side !== "ignored" && row.impactPoints >= 0.4)
      .map((row) => `${row.player} ${row.position} ${row.status}`),
  };
}
