import { weatherTotalAdjustment } from "./adjustments";
import { assertFiniteNumber } from "./odds";
import type {
  GameEdgeContext,
  InjuryListing,
  League,
  MarketBookLine,
  MarketConsensus,
  MarketLines,
  NewsItem,
  NewsTag,
  TeamInjuryImpact,
  TeamRef,
  UpcomingGame,
  WeatherForecast,
} from "./types";

const TEAM_IMPACT_CAP = 6;
const QUESTIONABLE_WEIGHT = 0.35;
const IR_WEIGHT = 0.15;
const QB_IR_ONLY = 0.4;

export type InjuryStatus = "out" | "doubtful" | "questionable" | "ir" | "suspension" | "active" | "other";

export interface ParsedInjury {
  player: string;
  position: string;
  status: string;
  comment?: string;
  teamAbbr?: string;
  espnTeamId?: string;
  teamName?: string;
}

const NFL_OUT_POINTS: Record<string, number> = {
  QB: 3.8,
  OT: 1.1,
  T: 1.1,
  LT: 1.1,
  RT: 1.1,
  C: 1.0,
  G: 0.55,
  LG: 0.55,
  RG: 0.55,
  OL: 0.7,
  WR: 0.55,
  TE: 0.4,
  RB: 0.45,
  FB: 0.2,
  DE: 0.7,
  EDGE: 0.7,
  OLB: 0.55,
  DT: 0.45,
  NT: 0.45,
  DL: 0.45,
  LB: 0.35,
  ILB: 0.35,
  MLB: 0.35,
  CB: 0.7,
  S: 0.5,
  FS: 0.5,
  SS: 0.5,
  DB: 0.45,
  PK: 0.35,
  K: 0.35,
  P: 0.15,
};

export function normalizeInjuryStatus(raw: string | undefined): InjuryStatus {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return "other";
  }
  const status = raw.trim().toLowerCase();
  if (status === "out") {
    return "out";
  }
  if (status === "doubtful") {
    return "doubtful";
  }
  if (status === "questionable") {
    return "questionable";
  }
  if (status === "active") {
    return "active";
  }
  if (status.includes("suspend")) {
    return "suspension";
  }
  if (status.includes("reserve") || status.includes("unable") || status === "pup" || status === "ir") {
    return "ir";
  }
  return "other";
}

export function statusWeight(status: InjuryStatus, position: string): number {
  if (status === "out" || status === "doubtful" || status === "suspension") {
    return 1;
  }
  if (status === "questionable") {
    return QUESTIONABLE_WEIGHT;
  }
  if (status === "ir") {
    return position === "QB" ? 0 : IR_WEIGHT;
  }
  return 0;
}

function positionGroup(position: string): "qb" | "ol" | "wr" | "offense" | "defense" | "special" {
  const pos = position.toUpperCase();
  if (pos === "QB") {
    return "qb";
  }
  if (["OT", "T", "LT", "RT", "C", "G", "LG", "RG", "OL"].includes(pos)) {
    return "ol";
  }
  if (pos === "WR") {
    return "wr";
  }
  if (["PK", "K", "P", "LS"].includes(pos)) {
    return "special";
  }
  if (["DE", "EDGE", "OLB", "DT", "NT", "DL", "LB", "ILB", "MLB", "CB", "S", "FS", "SS", "DB"].includes(pos)) {
    return "defense";
  }
  return "offense";
}

function outPoints(league: League, position: string): number {
  const base = NFL_OUT_POINTS[position.toUpperCase()] ?? 0.15;
  if (league === "ncaaf") {
    return position.toUpperCase() === "QB" ? 5.2 : base * 1.1;
  }
  return base;
}

function listingSide(group: ReturnType<typeof positionGroup>): InjuryListing["side"] {
  if (group === "defense") {
    return "defense";
  }
  if (group === "special") {
    return "special";
  }
  return "offense";
}

export function emptyTeamInjury(team: TeamRef): TeamInjuryImpact {
  return {
    teamId: team.id,
    teamAbbr: team.abbreviation,
    qbPoints: 0,
    offensePoints: 0,
    defensePoints: 0,
    listings: [],
  };
}

export function scoreTeamInjuries(args: {
  league: League;
  team: TeamRef;
  listings: ParsedInjury[];
}): TeamInjuryImpact {
  if (!Array.isArray(args.listings)) {
    throw new Error("listings must be an array");
  }
  const listings: InjuryListing[] = [];
  const qbRows: Array<{ listing: InjuryListing; status: InjuryStatus; weight: number; full: number }> = [];
  let olOutCount = 0;
  let wrPoints = 0;
  let offense = 0;
  let defense = 0;

  for (const row of args.listings) {
    const position = (row.position || "?").toUpperCase();
    const status = normalizeInjuryStatus(row.status);
    const group = positionGroup(position);
    const full = outPoints(args.league, position);
    const weight = statusWeight(status, position);
    const impact = Number((full * weight).toFixed(3));
    const listing: InjuryListing = {
      player: row.player,
      position,
      status: row.status,
      comment: row.comment,
      impactPoints: impact,
      side: weight === 0 ? "ignored" : listingSide(group),
    };
    listings.push(listing);
    if (group === "qb") {
      qbRows.push({ listing, status, weight, full });
      continue;
    }
    if (weight === 0) {
      continue;
    }
    if (group === "ol" && weight >= 1) {
      olOutCount += 1;
    }
    if (group === "wr") {
      wrPoints += impact;
      continue;
    }
    if (listing.side === "defense") {
      defense += impact;
    } else {
      offense += impact;
    }
  }

  wrPoints = Math.min(wrPoints, args.league === "ncaaf" ? 1.8 : 1.6);
  offense += wrPoints;

  let clusterNote: string | undefined;
  if (olOutCount >= 3) {
    offense += 1.2;
    clusterNote = `${olOutCount} starting-caliber OL out`;
  } else if (olOutCount === 2) {
    offense += 0.6;
    clusterNote = "Two OL out";
  }

  let qbPoints = 0;
  const qbUnavailable = qbRows.filter((row) => row.status === "out" || row.status === "doubtful" || row.status === "suspension");
  const qbQuestionable = qbRows.filter((row) => row.status === "questionable");
  const qbIr = qbRows.filter((row) => row.status === "ir");
  if (qbUnavailable.length > 0) {
    const best = qbUnavailable.reduce((a, b) => (a.full >= b.full ? a : b));
    qbPoints = -best.full;
  } else if (qbQuestionable.length > 0) {
    const best = qbQuestionable.reduce((a, b) => (a.full >= b.full ? a : b));
    qbPoints = -(best.full * QUESTIONABLE_WEIGHT);
  } else if (qbIr.length > 0) {
    qbPoints = -QB_IR_ONLY;
  }

  const uncapped = Math.abs(qbPoints) + offense + defense;
  if (uncapped > TEAM_IMPACT_CAP && uncapped > 0) {
    const scale = TEAM_IMPACT_CAP / uncapped;
    qbPoints *= scale;
    offense *= scale;
    defense *= scale;
  }

  return {
    teamId: args.team.id,
    teamAbbr: args.team.abbreviation,
    qbPoints: Number(qbPoints.toFixed(3)),
    offensePoints: Number(offense.toFixed(3)),
    defensePoints: Number(defense.toFixed(3)),
    listings,
    clusterNote,
  };
}

export function weatherFromForecast(args: {
  indoor?: boolean;
  roof?: string;
  city?: string;
  state?: string;
  temperatureF?: number;
  windMph?: number;
  windGustMph?: number;
  precipProbability?: number;
  precipMm?: number;
  snowfallCm?: number;
  humidity?: number;
  source?: WeatherForecast["source"];
}): WeatherForecast {
  const indoor = Boolean(args.indoor || args.roof === "dome" || args.roof === "closed");
  const totalAdjustment = indoor
    ? 0
    : weatherTotalAdjustment({
        indoor,
        roof: args.roof,
        windMph: args.windMph,
        windGustMph: args.windGustMph,
        precipProbability: args.precipProbability,
        precipMm: args.precipMm,
        snowfallCm: args.snowfallCm,
        temperatureF: args.temperatureF,
      });
  const bits: string[] = [];
  if (indoor) {
    bits.push("indoor");
  } else {
    if (args.temperatureF !== undefined) {
      bits.push(`${Math.round(args.temperatureF)}°F`);
    }
    if (args.windMph !== undefined) {
      bits.push(`wind ${Math.round(args.windMph)} mph`);
    }
    if ((args.precipProbability ?? 0) >= 40) {
      bits.push(`${Math.round(args.precipProbability ?? 0)}% precip`);
    }
    if ((args.snowfallCm ?? 0) >= 0.2) {
      bits.push("snow");
    }
  }
  return {
    source: args.source ?? (indoor ? "none" : "open-meteo"),
    indoor,
    city: args.city,
    state: args.state,
    temperatureF: args.temperatureF,
    windMph: args.windMph,
    windGustMph: args.windGustMph,
    precipProbability: args.precipProbability,
    precipMm: args.precipMm,
    snowfallCm: args.snowfallCm,
    humidity: args.humidity,
    description: bits.join(", ") || (indoor ? "indoor" : "no forecast"),
    totalAdjustment: Number(totalAdjustment.toFixed(3)),
  };
}

export function median(values: number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return undefined;
  }
  const sorted = finite.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid];
  if (left === undefined) {
    return undefined;
  }
  if (sorted.length % 2 === 1) {
    return left;
  }
  const right = sorted[mid - 1];
  if (right === undefined) {
    return left;
  }
  return (right + left) / 2;
}

export function consensusFromBooks(args: {
  books: MarketBookLine[];
  espn?: MarketLines;
}): MarketConsensus {
  if (!Array.isArray(args.books)) {
    throw new Error("books must be an array");
  }
  const now = Date.now();
  const recent = args.books.filter((book) => {
    if (!book.updatedIso) {
      return true;
    }
    const ts = Date.parse(book.updatedIso);
    return Number.isFinite(ts) && now - ts <= 7 * 86_400_000;
  });
  const pool = recent.length >= 2 ? recent : args.books;
  const spreads = pool.flatMap((book) => (book.homeSpread !== undefined ? [book.homeSpread] : []));
  const totals = pool.flatMap((book) => (book.total !== undefined ? [book.total] : []));
  const consensusHomeSpread = median(spreads);
  const consensusTotal = median(totals);
  const spreadRange = spreads.length >= 2 ? Math.max(...spreads) - Math.min(...spreads) : undefined;
  const totalRange = totals.length >= 2 ? Math.max(...totals) - Math.min(...totals) : undefined;
  const espnSpreadMove =
    args.espn?.homeSpread !== undefined && args.espn.openHomeSpread !== undefined
      ? args.espn.homeSpread - args.espn.openHomeSpread
      : undefined;
  const espnTotalMove =
    args.espn?.total !== undefined && args.espn.openTotal !== undefined
      ? args.espn.total - args.espn.openTotal
      : undefined;
  return {
    books: args.books,
    consensusHomeSpread,
    consensusTotal,
    bestHomeSpread: spreads.length > 0 ? Math.max(...spreads) : undefined,
    bestAwaySpread: spreads.length > 0 ? -Math.min(...spreads) : undefined,
    spreadRange,
    totalRange,
    espnSpreadMove,
    espnTotalMove,
    steamHint: (spreadRange ?? 0) >= 1.5 && pool.length >= 3,
  };
}

const NEWS_RULES: Array<{ tag: NewsTag; pattern: RegExp }> = [
  { tag: "qb", pattern: /\b(qb|quarterback)\b/i },
  { tag: "injury", pattern: /\b(injur|out for|ruled out|questionable|doubtful|concussion|acl|achilles|ir\b|inactive)\b/i },
  { tag: "suspension", pattern: /\b(suspend|arrest|eligib)/i },
  { tag: "weather", pattern: /\b(wind|snow|rain|storm|hurricane|weather|tornado)\b/i },
  { tag: "coaching", pattern: /\b(coach|coordinator|play-caller|fired|resign)/i },
];

export function tagNewsText(text: string): NewsTag[] {
  if (typeof text !== "string") {
    throw new Error("news text is required");
  }
  const tags = NEWS_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.tag);
  return tags.length > 0 ? tags : ["other"];
}

const ABBR_ALIASES: Record<string, string[]> = {
  LAR: ["LA"],
  LA: ["LAR"],
  JAX: ["JAC"],
  JAC: ["JAX"],
  WSH: ["WAS"],
  WAS: ["WSH"],
  NCSU: ["NCST"],
  NCST: ["NCSU"],
  RUTG: ["RUT"],
  RUT: ["RUTG"],
};

export function equivalentAbbr(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  if (a === b) {
    return true;
  }
  return (ABBR_ALIASES[a] ?? []).includes(b) || (ABBR_ALIASES[b] ?? []).includes(a);
}

function hasWord(haystack: string, needle: string): boolean {
  if (needle.trim().length < 2) {
    return false;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(haystack);
}

export function newsMatchesTeam(item: NewsItem, team: TeamRef): boolean {
  if (item.teamAbbrs.some((abbr) => equivalentAbbr(abbr, team.abbreviation))) {
    return true;
  }
  const blob = item.headline;
  if (team.name.length >= 5 && blob.toLowerCase().includes(team.name.toLowerCase())) {
    return true;
  }
  const nick = team.name.split(/\s+/).at(-1) ?? "";
  if (nick.length >= 5 && hasWord(blob, nick)) {
    return true;
  }
  return hasWord(blob, team.abbreviation);
}

export function newsQbFlag(items: NewsItem[], team: TeamRef, alreadyHasQb: boolean): boolean {
  if (alreadyHasQb) {
    return false;
  }
  return items.some(
    (item) =>
      newsMatchesTeam(item, team) &&
      item.tags.includes("qb") &&
      (item.tags.includes("injury") || item.tags.includes("suspension")),
  );
}

function impactNote(team: TeamRef, impact: TeamInjuryImpact): string | undefined {
  const qb = impact.listings.find(
    (row) => row.position === "QB" && row.side !== "ignored" && Math.abs(row.impactPoints) > 0,
  );
  if (impact.qbPoints <= -1) {
    return `${team.abbreviation} QB ${qb?.player ?? "unavailable"} (${impact.qbPoints.toFixed(1)})`;
  }
  const total = Math.abs(impact.qbPoints) + impact.offensePoints + impact.defensePoints;
  if (total >= 1.2) {
    return `${team.abbreviation} injuries −${total.toFixed(1)} pts`;
  }
  if (impact.clusterNote) {
    return `${team.abbreviation} ${impact.clusterNote}`;
  }
  return undefined;
}

export function buildGameEdgeContext(args: {
  game: UpcomingGame;
  homeInjuries: ParsedInjury[];
  awayInjuries: ParsedInjury[];
  weather: WeatherForecast;
  books: MarketBookLine[];
  news: NewsItem[];
  capturedAt?: string;
}): GameEdgeContext {
  const home = scoreTeamInjuries({
    league: args.game.league,
    team: args.game.home,
    listings: args.homeInjuries,
  });
  const away = scoreTeamInjuries({
    league: args.game.league,
    team: args.game.away,
    listings: args.awayInjuries,
  });
  const relevantNews = args.news.filter(
    (item) => newsMatchesTeam(item, args.game.home) || newsMatchesTeam(item, args.game.away),
  );
  if (newsQbFlag(relevantNews, args.game.home, home.qbPoints < 0)) {
    home.qbPoints = Number((-(outPoints(args.game.league, "QB") * QUESTIONABLE_WEIGHT)).toFixed(3));
    home.listings.push({
      player: "QB (news flag)",
      position: "QB",
      status: "Questionable",
      comment: "Headline flagged a QB injury that was missing from the injury report.",
      impactPoints: Math.abs(home.qbPoints),
      side: "offense",
    });
  }
  if (newsQbFlag(relevantNews, args.game.away, away.qbPoints < 0)) {
    away.qbPoints = Number((-(outPoints(args.game.league, "QB") * QUESTIONABLE_WEIGHT)).toFixed(3));
    away.listings.push({
      player: "QB (news flag)",
      position: "QB",
      status: "Questionable",
      comment: "Headline flagged a QB injury that was missing from the injury report.",
      impactPoints: Math.abs(away.qbPoints),
      side: "offense",
    });
  }

  const injuryHome = Number((-home.offensePoints + away.defensePoints).toFixed(3));
  const injuryAway = Number((-away.offensePoints + home.defensePoints).toFixed(3));
  const market = consensusFromBooks({ books: args.books, espn: args.game.market });
  const notes = [
    impactNote(args.game.home, home),
    impactNote(args.game.away, away),
    args.weather.indoor ? undefined : args.weather.description,
    market.espnSpreadMove !== undefined && Math.abs(market.espnSpreadMove) >= 1
      ? `spread moved ${market.espnSpreadMove > 0 ? "+" : ""}${market.espnSpreadMove.toFixed(1)}`
      : undefined,
    market.steamHint ? "books disagree by 1.5+ pts" : undefined,
  ].filter((note): note is string => Boolean(note));

  return {
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    injuries: { home, away },
    weather: args.weather,
    market,
    news: relevantNews.slice(0, 8),
    scoreAdjustments: {
      qbHome: home.qbPoints,
      qbAway: away.qbPoints,
      injuryHome,
      injuryAway,
      weatherTotal: args.weather.totalAdjustment,
    },
    notes,
  };
}

export function edgeAdjustments(game: UpcomingGame): {
  qbHome: number;
  qbAway: number;
  injuryHome: number;
  injuryAway: number;
  weather: WeatherForecast;
} {
  const edge = game.edge;
  if (!edge) {
    return {
      qbHome: 0,
      qbAway: 0,
      injuryHome: 0,
      injuryAway: 0,
      weather: weatherFromForecast({
        indoor: game.indoor,
        roof: game.roof,
        temperatureF: game.temperatureF,
        windMph: game.windMph,
        city: game.venueCity,
        state: game.venueState,
        source: "none",
      }),
    };
  }
  assertFiniteNumber(edge.scoreAdjustments.qbHome, "qbHome");
  assertFiniteNumber(edge.scoreAdjustments.qbAway, "qbAway");
  assertFiniteNumber(edge.scoreAdjustments.injuryHome, "injuryHome");
  assertFiniteNumber(edge.scoreAdjustments.injuryAway, "injuryAway");
  return {
    qbHome: edge.scoreAdjustments.qbHome,
    qbAway: edge.scoreAdjustments.qbAway,
    injuryHome: edge.scoreAdjustments.injuryHome,
    injuryAway: edge.scoreAdjustments.injuryAway,
    weather: edge.weather,
  };
}
