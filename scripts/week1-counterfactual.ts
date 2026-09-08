import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCfbFactorStore } from "@/src/data/cfbFactors";
import { loadNflFactorStore } from "@/src/data/nflFactors";
import {
  attachRestDays,
  fetchEspnScoreboard,
  fetchEspnSeason,
  isCompletedGame,
} from "@/src/data/espn";
import { attachHistoricalClosingOdds } from "@/src/data/espnOdds";
import { cachedJson } from "@/src/data/httpCache";
import { readSnapshot } from "@/src/data/loadSnapshot";
import { geocodeVenue } from "@/src/data/weeklyIngest";
import { realizedBankrollChange } from "@/src/lib/ev";
import { handicapMatchup } from "@/src/lib/matchup";
import { americanToImplied } from "@/src/lib/odds";
import { alignmentScore, selectProfitBestBet } from "@/src/lib/picks";
import { fitTeamRatings } from "@/src/lib/ratings";
import type { FactorLookup } from "@/src/lib/rithmm/types";
import {
  buildGameEdgeContext,
  equivalentAbbr,
  weatherFromForecast,
} from "@/src/lib/weeklyEdge";
import { gradeCompletedSide } from "@/src/lib/walkForward";
import type {
  CompletedGame,
  GameEdgeContext,
  MarketLines,
  PricedSide,
  TeamRating,
  UpcomingGame,
  WeatherForecast,
} from "@/src/lib/types";

const MIN_TEAM_GAMES = 6;

type SideSnap = {
  label: string | null;
  type: string | null;
  p: number | null;
  edge: number | null;
  ev: number | null;
  confidence: number;
  alignment: number | null;
  grade: string | null;
  units: number;
};

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unitsFor(side: PricedSide, result: "W" | "L" | "P"): number {
  if (result === "P") {
    return 0;
  }
  return realizedBankrollChange({ wins: [result === "W" ? 1 : 0], s: americanToImplied(side.americanOdds), stake: 1 });
}

function recordFrom(rows: Array<{ grade: string | null; units: number }>): {
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number | null;
} {
  const graded = rows.filter((row) => row.grade === "W" || row.grade === "L" || row.grade === "P");
  const wins = graded.filter((row) => row.grade === "W").length;
  const losses = graded.filter((row) => row.grade === "L").length;
  const pushes = graded.filter((row) => row.grade === "P").length;
  const action = wins + losses;
  const units = graded.reduce((sum, row) => sum + row.units, 0);
  return {
    n: graded.length,
    wins,
    losses,
    pushes,
    units,
    roi: action > 0 ? units / action : null,
  };
}

async function archiveWeather(game: UpcomingGame | CompletedGame): Promise<WeatherForecast> {
  const upcoming = game as UpcomingGame;
  if (upcoming.indoor || upcoming.roof === "dome" || upcoming.roof === "closed") {
    return weatherFromForecast({
      indoor: true,
      roof: upcoming.roof,
      city: upcoming.venueCity,
      state: upcoming.venueState,
      source: "none",
    });
  }
  const city = upcoming.venueCity;
  if (!city) {
    return weatherFromForecast({
      indoor: false,
      roof: upcoming.roof,
      city,
      state: upcoming.venueState,
      temperatureF: upcoming.temperatureF,
      source: "none",
    });
  }
  try {
    const coords = await geocodeVenue(city, upcoming.venueState);
    if (!coords) {
      return weatherFromForecast({
        indoor: false,
        roof: upcoming.roof,
        city,
        state: upcoming.venueState,
        temperatureF: upcoming.temperatureF,
        source: "none",
      });
    }
    const day = upcoming.kickoffIso.slice(0, 10);
    const payload = await cachedJson<{
      hourly?: {
        time?: string[];
        temperature_2m?: Array<number | null>;
        precipitation?: Array<number | null>;
        snowfall?: Array<number | null>;
        wind_speed_10m?: Array<number | null>;
        wind_gusts_10m?: Array<number | null>;
      };
    }>({
      url: `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.lat}&longitude=${coords.lon}&start_date=${day}&end_date=${day}&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC`,
      fileName: `archive-weather-${coords.lat.toFixed(2)}-${coords.lon.toFixed(2)}-${day}.json`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
    });
    const times = payload.hourly?.time ?? [];
    const target = Date.parse(upcoming.kickoffIso);
    let idx = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
      const stamp = times[i];
      if (!stamp) {
        continue;
      }
      const parsed = Date.parse(stamp.endsWith("Z") || stamp.includes("+") ? stamp : `${stamp}:00Z`);
      const delta = Math.abs(parsed - target);
      if (delta < best) {
        best = delta;
        idx = i;
      }
    }
    const num = (series: Array<number | null> | undefined): number | undefined => {
      const value = series?.[idx];
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    };
    const precipMm = num(payload.hourly?.precipitation);
    return weatherFromForecast({
      indoor: false,
      roof: upcoming.roof,
      city,
      state: upcoming.venueState,
      temperatureF: num(payload.hourly?.temperature_2m) ?? upcoming.temperatureF,
      windMph: num(payload.hourly?.wind_speed_10m),
      windGustMph: num(payload.hourly?.wind_gusts_10m),
      precipMm,
      precipProbability: precipMm !== undefined && precipMm >= 0.5 ? 60 : 0,
      snowfallCm: num(payload.hourly?.snowfall),
      source: "open-meteo",
    });
  } catch {
    return weatherFromForecast({
      indoor: false,
      roof: upcoming.roof,
      city,
      state: upcoming.venueState,
      temperatureF: upcoming.temperatureF,
      source: "none",
    });
  }
}

function weatherEdge(game: UpcomingGame | CompletedGame, weather: WeatherForecast): GameEdgeContext {
  return buildGameEdgeContext({
    game: game as UpcomingGame,
    homeInjuries: [],
    awayInjuries: [],
    weather,
    books: [],
    news: [],
  });
}

type CompactEdge = {
  id: string;
  matchup: string;
  qbHome: number;
  qbAway: number;
  injuryHome: number;
  injuryAway: number;
  weatherTotal: number;
  weather?: string;
  windMph?: number;
  notes: string[];
  spreadMove?: number;
  consensusSpread?: number;
  consensusTotal?: number;
};

function parseTempF(description: string | undefined): number | undefined {
  if (!description) {
    return undefined;
  }
  const match = description.match(/(-?\d+(?:\.\d+)?)\s*°F/);
  return match?.[1] !== undefined ? Number(match[1]) : undefined;
}

function findCompactEdge(game: UpcomingGame, rows: CompactEdge[]): CompactEdge | undefined {
  return rows.find((row) => {
    const [away, home] = row.matchup.split(" @ ").map((part) => part.trim());
    return equivalentAbbr(away, game.away.abbreviation) && equivalentAbbr(home, game.home.abbreviation);
  });
}

function compactToEdge(game: UpcomingGame, compact: CompactEdge): GameEdgeContext {
  const weather = weatherFromForecast({
    indoor: Boolean(game.indoor),
    roof: game.roof,
    windMph: compact.windMph,
    temperatureF: parseTempF(compact.weather),
    source: compact.weather ? "open-meteo" : "none",
  });
  return {
    capturedAt: new Date().toISOString(),
    injuries: {
      home: {
        teamId: game.home.id,
        teamAbbr: game.home.abbreviation,
        qbPoints: compact.qbHome,
        offensePoints: 0,
        defensePoints: 0,
        listings: [],
      },
      away: {
        teamId: game.away.id,
        teamAbbr: game.away.abbreviation,
        qbPoints: compact.qbAway,
        offensePoints: 0,
        defensePoints: 0,
        listings: [],
      },
    },
    weather,
    market: {
      books: [],
      steamHint: compact.notes.some((note) => note.includes("disagree")),
      espnSpreadMove: compact.spreadMove,
      consensusHomeSpread: compact.consensusSpread,
      consensusTotal: compact.consensusTotal,
    },
    news: [],
    scoreAdjustments: {
      qbHome: compact.qbHome,
      qbAway: compact.qbAway,
      injuryHome: compact.injuryHome,
      injuryAway: compact.injuryAway,
      weatherTotal: weather.totalAdjustment,
    },
    notes: compact.notes,
  };
}

function topSide(priced: PricedSide[]): { label: string; p: number; ev: number } | null {
  const top = [...priced].sort((a, b) => b.evPerUnit - a.evPerUnit)[0];
  return top ? { label: top.label, p: top.handicappedP, ev: top.evPerUnit } : null;
}

function priceGame(args: {
  game: UpcomingGame | CompletedGame;
  ratings: TeamRating[];
  factorLookup?: FactorLookup;
  edge?: GameEdgeContext;
}): {
  pick: PricedSide | null;
  priced: PricedSide[];
  alignment: number | null;
  confidence: number;
  margin: number;
  total: number;
  processNotes: string[];
  weatherTotal: number;
} {
  const game = args.edge ? { ...args.game, edge: args.edge } : { ...args.game };
  const report = handicapMatchup({
    game,
    ratings: args.ratings,
    factorLookup: args.factorLookup,
    priceWithHouse: false,
  });
  const row = { game: game as UpcomingGame, report, bestBet: null };
  const pick = selectProfitBestBet(row);
  return {
    pick,
    priced: report.priced,
    alignment: pick ? alignmentScore(row, pick) : null,
    confidence: report.confidence.score,
    margin: report.projection.margin,
    total: report.projection.total,
    processNotes: report.diagnostics.filter((d) => d.key === "process" || d.key === "travel").map((d) => d.note),
    weatherTotal: report.adjustments.weatherTotal,
  };
}

function sideSnap(
  game: CompletedGame,
  priced: ReturnType<typeof priceGame>,
): SideSnap {
  if (!priced.pick) {
    return {
      label: null,
      type: null,
      p: null,
      edge: null,
      ev: null,
      confidence: priced.confidence,
      alignment: priced.alignment,
      grade: "SIT",
      units: 0,
    };
  }
  const result = gradeCompletedSide(priced.pick, game);
  const grade = result ?? "SIT";
  return {
    label: priced.pick.label,
    type: priced.pick.betType,
    p: priced.pick.handicappedP,
    edge: priced.pick.edge,
    ev: priced.pick.evPerUnit,
    confidence: priced.confidence,
    alignment: priced.alignment,
    grade,
    units: result ? unitsFor(priced.pick, result) : 0,
  };
}

async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(slice.map(fn))));
  }
  return out;
}

function matchPublished(priced: PricedSide[], published: string): PricedSide | undefined {
  const needle = published.toLowerCase().replace(/\s+/g, "");
  return priced.find((side) => {
    const label = side.label.toLowerCase().replace(/\s+/g, "");
    if (needle.includes("ml")) {
      return label.includes("ml") && needle.startsWith(label.slice(0, 3));
    }
    if (needle.startsWith("under")) {
      return side.side === "under";
    }
    if (needle.startsWith("over")) {
      return side.side === "over";
    }
    return label.includes(needle.slice(0, 6)) || needle.includes(label.slice(0, 6));
  });
}

const FEATURED = [
  { key: "WYO@CSU", pick: "Under 46.5", publishedP: 0.682, publishedEv: 0.302, line: { total: 46.5, underOdds: -110, overOdds: -110 } },
  { key: "CLEM@LSU", pick: "Under 49.5", publishedP: 0.681, publishedEv: 0.3, line: { total: 49.5, underOdds: -110, overOdds: -110 } },
  { key: "WKU@NEV", pick: "WKU ML", publishedP: 0.622, publishedEv: 0.177, line: { homeSpread: 1.5, homeMoneyline: -108, awayMoneyline: -112 } },
  { key: "WMU@MICH", pick: "Under 49.5", publishedP: 0.643, publishedEv: 0.218, line: { total: 49.5, underOdds: -112, overOdds: -108 } },
  { key: "UNLV@HAW", pick: "Over 55.5", publishedP: 0.664, publishedEv: 0.257, line: { total: 55.5, underOdds: -108, overOdds: -112 } },
  { key: "UCLA@CAL", pick: "CAL +2.5", publishedP: 0.64, publishedEv: 0.267, line: { homeSpread: 2.5, homeSpreadOdds: -102, awaySpreadOdds: -118 } },
] as const;

async function main(): Promise<void> {
  process.stderr.write("Loading 2024-25 history, Week 1 scores, and 2025 CFB process cards...\n");
  const [twoYearsAgo, prior, week1Raw, cfbStore] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: 2024, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year: 2025, includePostseason: true, maxWeek: 16 }),
    fetchEspnScoreboard({ league: "ncaaf", week: 1, seasonType: 2, year: 2026, limit: 300 }),
    loadCfbFactorStore([2024, 2025, 2026]),
  ]);
  const history = attachRestDays([...twoYearsAgo, ...prior].filter(isCompletedGame));
  const week1 = attachRestDays(await attachHistoricalClosingOdds(week1Raw.filter(isCompletedGame), { concurrency: 8 }));
  const ratings = fitTeamRatings(history, "ncaaf");
  const rated = new Map(ratings.map((row) => [row.team.id, row]));
  const lookup: FactorLookup = (teamId, season, week) => cfbStore.lookup(teamId, season, week);

  process.stderr.write(`History ${history.length}. Week 1 ${week1.length}. Fetching archive weather...\n`);
  const weatherById = new Map<string, WeatherForecast>();
  await mapLimited(week1, 4, async (game) => {
    weatherById.set(game.id, await archiveWeather(game));
  });

  const rows = week1
    .slice()
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso))
    .map((game) => {
      const home = rated.get(game.home.id);
      const away = rated.get(game.away.id);
      const matchup = `${game.away.abbreviation} @ ${game.home.abbreviation}`;
      if (!home || !away || home.games < MIN_TEAM_GAMES || away.games < MIN_TEAM_GAMES || !game.market) {
        return null;
      }
      const weather = weatherById.get(game.id);
      const edge = weather ? weatherEdge(game, weather) : undefined;
      const original = priceGame({ game, ratings });
      const withMetrics = priceGame({ game, ratings, factorLookup: lookup, edge });
      return {
        matchup,
        kickoffIso: game.kickoffIso,
        indoor: Boolean((game as UpcomingGame).indoor),
        processMatched: Boolean(lookup(game.home.id, game.season, game.week) && lookup(game.away.id, game.season, game.week)),
        originalModel: { margin: original.margin, total: original.total },
        newModel: { margin: withMetrics.margin, total: withMetrics.total },
        dMargin: withMetrics.margin - original.margin,
        dTotal: withMetrics.total - original.total,
        weatherTotal: withMetrics.weatherTotal,
        processNotes: withMetrics.processNotes,
        original: sideSnap(game, original),
        withMetrics: sideSnap(game, withMetrics),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const origBook = rows.map((row) => row.original);
  const newBook = rows.map((row) => row.withMetrics);
  const origBets = origBook.filter((row) => row.grade === "W" || row.grade === "L" || row.grade === "P");
  const newBets = newBook.filter((row) => row.grade === "W" || row.grade === "L" || row.grade === "P");
  const pickChanges = rows.filter((row) => row.original.label !== row.withMetrics.label);

  const featured = FEATURED.map((item) => {
    const game = week1.find((row) => `${row.away.abbreviation}@${row.home.abbreviation}` === item.key);
    if (!game) {
      return { ...item, missing: true };
    }
    const market: MarketLines = { ...game.market, ...item.line };
    const pricedGame = { ...game, market };
    const weather = weatherById.get(game.id);
    const edge = weather ? weatherEdge(pricedGame, weather) : undefined;
    const original = priceGame({ game: pricedGame, ratings });
    const withMetrics = priceGame({ game: pricedGame, ratings, factorLookup: lookup, edge });
    const origTicket = matchPublished(original.priced, item.pick);
    const newTicket = matchPublished(withMetrics.priced, item.pick);
    return {
      matchup: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
      publishedPick: item.pick,
      publishedP: item.publishedP,
      publishedEv: item.publishedEv,
      originalTicket: origTicket
        ? { label: origTicket.label, p: origTicket.handicappedP, ev: origTicket.evPerUnit }
        : null,
      newTicket: newTicket
        ? { label: newTicket.label, p: newTicket.handicappedP, ev: newTicket.evPerUnit }
        : null,
      originalGatePick: original.pick?.label ?? "SIT",
      newGatePick: withMetrics.pick?.label ?? "SIT",
      originalConfidence: original.confidence,
      newConfidence: withMetrics.confidence,
      dTotal: withMetrics.total - original.total,
      dMargin: withMetrics.margin - original.margin,
      stillClearsGate: Boolean(withMetrics.pick),
    };
  });

  const snapshot = await readSnapshot();
  const nflStore = await loadNflFactorStore([2024, 2025]).catch(() => null);
  const weekEdge = JSON.parse(
    await (await import("node:fs/promises")).readFile(path.join(process.cwd(), "data", "week-edge.json"), "utf8"),
  ) as { games: CompactEdge[] };
  const compactNfl = weekEdge.games.filter((row) => row.id.startsWith("nfl:"));
  const nflLookup: FactorLookup | undefined = nflStore
    ? (teamId, season, week) => nflStore.lookup(teamId, season, week)
    : undefined;
  const nflRatings = snapshot?.nfl.ratings ?? [];

  const nflRows = (snapshot?.nfl.board ?? [])
    .filter((row) => row.game.week === 1)
    .map((row) => {
      const compact = findCompactEdge(row.game, compactNfl);
      const game: UpcomingGame = { ...row.game };
      const processOnly = handicapMatchup({
        game,
        ratings: nflRatings,
        factorLookup: nflLookup,
        priceWithHouse: true,
      });
      const withMetrics = handicapMatchup({
        game: compact ? { ...game, edge: compactToEdge(game, compact) } : game,
        ratings: nflRatings,
        factorLookup: nflLookup,
        priceWithHouse: true,
      });
      return {
        matchup: `${row.game.away.abbreviation} @ ${row.game.home.abbreviation}`,
        edgeMatched: Boolean(compact),
        originalModel: {
          margin: row.report.projection.margin,
          total: row.report.projection.total,
        },
        processOnlyModel: { margin: processOnly.projection.margin, total: processOnly.projection.total },
        newModel: { margin: withMetrics.projection.margin, total: withMetrics.projection.total },
        dMargin: withMetrics.projection.margin - row.report.projection.margin,
        dTotal: withMetrics.projection.total - row.report.projection.total,
        originalConfidence: row.report.confidence.score,
        processOnlyConfidence: processOnly.confidence.score,
        newConfidence: withMetrics.confidence.score,
        originalTop: topSide(row.report.priced),
        processOnlyTop: topSide(processOnly.priced),
        newTop: topSide(withMetrics.priced),
        notes: compact?.notes ?? [],
        qbHome: compact?.qbHome ?? 0,
        qbAway: compact?.qbAway ?? 0,
        injuryHome: compact?.injuryHome ?? 0,
        injuryAway: compact?.injuryAway ?? 0,
      };
    });
  const nflMatched = nflRows.filter((row) => row.edgeMatched);

  const payload = {
    generatedAt: new Date().toISOString(),
    notes: {
      ncaaf:
        "Week-level SRS on 2024-2025 only (true pre-Week-1 information). Process cards from 2025 sportsdataverse summaries. Historical Open-Meteo archive weather. Injuries/news/public % are NOT applied — the live APIs are Week 2 state and would leak.",
      nfl: "NFL Week 1 has not been played. Original numbers are the Sep 6 House snapshot (no edge object). Process-only adds nflverse leftovers. New numbers add current ESPN injury/weather ingest matched by abbreviation (nflverse id ≠ ESPN id). Still sat by policy.",
      liveBookUnchanged: "Profit gate and NFL sit are unchanged. This is a counterfactual, not a retune.",
    },
    ncaaf: {
      ratedGames: rows.length,
      processMatched: rows.filter((row) => row.processMatched).length,
      originalBook: {
        ...recordFrom(origBets),
        meanP: mean(origBets.map((row) => row.p ?? 0)),
        meanEv: mean(origBets.map((row) => row.ev ?? 0)),
        meanConfidence: mean(origBets.map((row) => row.confidence)),
      },
      withMetricsBook: {
        ...recordFrom(newBets),
        meanP: mean(newBets.map((row) => row.p ?? 0)),
        meanEv: mean(newBets.map((row) => row.ev ?? 0)),
        meanConfidence: mean(newBets.map((row) => row.confidence)),
      },
      meanAbsMarginShift: mean(rows.map((row) => Math.abs(row.dMargin))),
      meanAbsTotalShift: mean(rows.map((row) => Math.abs(row.dTotal))),
      pickChanges: pickChanges.map((row) => ({
        matchup: row.matchup,
        from: row.original.label,
        to: row.withMetrics.label,
        originalP: row.original.p,
        newP: row.withMetrics.p,
        originalEv: row.original.ev,
        newEv: row.withMetrics.ev,
      })),
      featuredSaturday: featured,
      bookedThen: rows
        .filter((row) => row.original.grade === "W" || row.original.grade === "L" || row.original.grade === "P")
        .map((row) => ({ matchup: row.matchup, ...row.original })),
      bookedNow: rows
        .filter((row) => row.withMetrics.grade === "W" || row.withMetrics.grade === "L" || row.withMetrics.grade === "P")
        .map((row) => ({
          matchup: row.matchup,
          ...row.withMetrics,
          dMargin: row.dMargin,
          dTotal: row.dTotal,
        })),
    },
    nflWeek1: {
      matched: nflMatched.length,
      games: nflRows.length,
      meanAbsMarginShift: mean(nflMatched.map((row) => Math.abs(row.dMargin))),
      meanAbsTotalShift: mean(nflMatched.map((row) => Math.abs(row.dTotal))),
      meanOriginalConfidence: mean(nflRows.map((row) => row.originalConfidence)),
      meanNewConfidence: mean(nflRows.map((row) => row.newConfidence)),
      meanOriginalTopP: mean(nflRows.map((row) => row.originalTop?.p ?? 0)),
      meanNewTopP: mean(nflRows.map((row) => row.newTop?.p ?? 0)),
      meanOriginalTopEv: mean(nflRows.map((row) => row.originalTop?.ev ?? 0)),
      meanNewTopEv: mean(nflRows.map((row) => row.newTop?.ev ?? 0)),
      rows: nflRows,
    },
  };

  const outPath = path.join(process.cwd(), "data", "week1-counterfactual.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  process.stderr.write(`Wrote ${outPath}\n`);
  console.log(
    JSON.stringify(
      {
        ncaafOriginal: payload.ncaaf.originalBook,
        ncaafWithMetrics: payload.ncaaf.withMetricsBook,
        meanAbsMarginShift: payload.ncaaf.meanAbsMarginShift,
        meanAbsTotalShift: payload.ncaaf.meanAbsTotalShift,
        pickChanges: payload.ncaaf.pickChanges,
        featuredSaturday: payload.ncaaf.featuredSaturday,
        nflSummary: {
          matched: payload.nflWeek1.matched,
          meanAbsMarginShift: payload.nflWeek1.meanAbsMarginShift,
          meanAbsTotalShift: payload.nflWeek1.meanAbsTotalShift,
          meanOriginalConfidence: payload.nflWeek1.meanOriginalConfidence,
          meanNewConfidence: payload.nflWeek1.meanNewConfidence,
          meanOriginalTopP: payload.nflWeek1.meanOriginalTopP,
          meanNewTopP: payload.nflWeek1.meanNewTopP,
          meanOriginalTopEv: payload.nflWeek1.meanOriginalTopEv,
          meanNewTopEv: payload.nflWeek1.meanNewTopEv,
        },
        nflWeek1: payload.nflWeek1.rows,

      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
