import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachHistoricalClosingOdds } from "@/src/data/espnOdds";
import {
  attachRestDays,
  fetchEspnScoreboard,
  fetchEspnSeason,
  isCompletedGame,
} from "@/src/data/espn";
import { readSnapshot } from "@/src/data/loadSnapshot";
import { backtestFlat, type HistoricalBet } from "@/src/lib/backtest";
import { realizedBankrollChange } from "@/src/lib/ev";
import { handicapMatchup } from "@/src/lib/matchup";
import { americanToImplied } from "@/src/lib/odds";
import { alignmentScore, pickQuality, selectProfitBestBet } from "@/src/lib/picks";
import { fitTeamRatings } from "@/src/lib/ratings";
import type { CompletedGame, PricedSide, ScoreProjection, TeamRating } from "@/src/lib/types";
import { gradeCompletedSide } from "@/src/lib/walkForward";

const MIN_TEAM_GAMES = 6;

type Grade = "W" | "L" | "P" | "SIT" | "UNRATED" | "NO_MARKET";

type ForecastRow = {
  gameId: string;
  kickoffIso: string;
  matchup: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  actualMargin: number;
  actualTotal: number;
  marketSpread?: number;
  marketTotal?: number;
  book?: string;
  modelMargin: number;
  modelTotal: number;
  modelAway: number;
  modelHome: number;
  winProbHome: number;
  coverProbHome: number;
  overProb: number;
  homeGames: number;
  awayGames: number;
  engine: string;
  pickLabel: string | null;
  pickType: string | null;
  pickSide: string | null;
  pickOdds: number | null;
  p: number | null;
  s: number | null;
  edge: number | null;
  evPerUnit: number | null;
  alignment: number | null;
  quality: number | null;
  grade: Grade;
  units: number;
  mlHit: boolean | null;
  atsHomeHit: boolean | null;
  totalOverHit: boolean | null;
};

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mae(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return mean(values.map((value) => Math.abs(value)));
}

function recordFrom(rows: Array<{ grade: Grade; units: number }>): {
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

function unitsFor(side: PricedSide, result: "W" | "L" | "P"): number {
  if (result === "P") {
    return 0;
  }
  const s = americanToImplied(side.americanOdds);
  return realizedBankrollChange({ wins: [result === "W" ? 1 : 0], s, stake: 1 });
}

function boolOrNull(value: boolean | undefined): boolean | null {
  return value === undefined ? null : value;
}

function projectRow(
  game: CompletedGame,
  ratings: TeamRating[],
): {
  report: ReturnType<typeof handicapMatchup>;
  pick: PricedSide | null;
  alignment: number | null;
} {
  const upcoming = { ...game };
  const report = handicapMatchup({
    game: upcoming,
    ratings,
    priceWithHouse: false,
  });
  const row = { game: upcoming, report, bestBet: null };
  const pick = selectProfitBestBet(row);
  return {
    report,
    pick,
    alignment: pick ? alignmentScore(row, pick) : null,
  };
}

function toForecastRow(
  game: CompletedGame,
  ratings: TeamRating[],
  rated: Map<string, TeamRating>,
): ForecastRow {
  const home = rated.get(game.home.id);
  const away = rated.get(game.away.id);
  const matchup = `${game.away.abbreviation} @ ${game.home.abbreviation}`;
  const actualMargin = game.homeScore - game.awayScore;
  const actualTotal = game.homeScore + game.awayScore;
  if (!home || !away || home.games < MIN_TEAM_GAMES || away.games < MIN_TEAM_GAMES) {
    return {
      gameId: game.id,
      kickoffIso: game.kickoffIso,
      matchup,
      away: game.away.abbreviation,
      home: game.home.abbreviation,
      awayScore: game.awayScore,
      homeScore: game.homeScore,
      actualMargin,
      actualTotal,
      marketSpread: game.market?.homeSpread,
      marketTotal: game.market?.total,
      book: game.market?.book,
      modelMargin: Number.NaN,
      modelTotal: Number.NaN,
      modelAway: Number.NaN,
      modelHome: Number.NaN,
      winProbHome: Number.NaN,
      coverProbHome: Number.NaN,
      overProb: Number.NaN,
      homeGames: home?.games ?? 0,
      awayGames: away?.games ?? 0,
      engine: "unrated",
      pickLabel: null,
      pickType: null,
      pickSide: null,
      pickOdds: null,
      p: null,
      s: null,
      edge: null,
      evPerUnit: null,
      alignment: null,
      quality: null,
      grade: "UNRATED",
      units: 0,
      mlHit: null,
      atsHomeHit: null,
      totalOverHit: null,
    };
  }

  const { report, pick, alignment } = projectRow(game, ratings);
  const projection: ScoreProjection = report.projection;
  const homeSpread = game.market?.homeSpread;
  const total = game.market?.total;
  let grade: Grade = "SIT";
  let units = 0;
  if (!game.market) {
    grade = "NO_MARKET";
  } else if (pick) {
    const result = gradeCompletedSide(pick, game);
    if (result === null) {
      grade = "SIT";
    } else {
      grade = result;
      units = unitsFor(pick, result);
    }
  }

  const atsHomeHit =
    homeSpread === undefined ? undefined : actualMargin + homeSpread === 0 ? undefined : actualMargin + homeSpread > 0;
  const totalOverHit = total === undefined ? undefined : actualTotal === total ? undefined : actualTotal > total;

  return {
    gameId: game.id,
    kickoffIso: game.kickoffIso,
    matchup,
    away: game.away.abbreviation,
    home: game.home.abbreviation,
    awayScore: game.awayScore,
    homeScore: game.homeScore,
    actualMargin,
    actualTotal,
    marketSpread: homeSpread,
    marketTotal: total,
    book: game.market?.book,
    modelMargin: projection.margin,
    modelTotal: projection.total,
    modelAway: projection.awayScore,
    modelHome: projection.homeScore,
    winProbHome: projection.winProbHome,
    coverProbHome: projection.coverProbHome,
    overProb: projection.overProb,
    homeGames: home.games,
    awayGames: away.games,
    engine: report.engine,
    pickLabel: pick?.label ?? null,
    pickType: pick?.betType ?? null,
    pickSide: pick?.side ?? null,
    pickOdds: pick?.americanOdds ?? null,
    p: pick?.handicappedP ?? null,
    s: pick?.impliedS ?? null,
    edge: pick?.edge ?? null,
    evPerUnit: pick?.evPerUnit ?? null,
    alignment,
    quality: pick ? pickQuality({ game, report, bestBet: pick }, pick) : null,
    grade,
    units,
    mlHit: actualMargin === 0 ? null : (projection.winProbHome >= 0.5) === (actualMargin > 0),
    atsHomeHit: boolOrNull(atsHomeHit),
    totalOverHit: boolOrNull(totalOverHit),
  };
}

function hitRate(values: Array<boolean | null>): { n: number; hits: number; rate: number | null } {
  const known = values.filter((value): value is boolean => value !== null);
  const hits = known.filter(Boolean).length;
  return { n: known.length, hits, rate: known.length > 0 ? hits / known.length : null };
}

function projectionSummary(rows: ForecastRow[]) {
  const rated = rows.filter((row) => Number.isFinite(row.modelMargin));
  const marginErrors = rated.map((row) => row.modelMargin - row.actualMargin);
  const totalErrors = rated.map((row) => row.modelTotal - row.actualTotal);
  const modelFavHome = rated.filter((row) => row.winProbHome >= 0.5);
  const modelFavAway = rated.filter((row) => row.winProbHome < 0.5);
  const atsModelHome = rated.filter((row) => row.marketSpread !== undefined && row.coverProbHome >= 0.5);
  const atsModelAway = rated.filter((row) => row.marketSpread !== undefined && row.coverProbHome < 0.5);
  const overSide = rated.filter((row) => row.marketTotal !== undefined && row.overProb >= 0.5);
  const underSide = rated.filter((row) => row.marketTotal !== undefined && row.overProb < 0.5);
  return {
    ratedGames: rated.length,
    marginMae: mae(marginErrors),
    marginBias: mean(marginErrors),
    totalMae: mae(totalErrors),
    totalBias: mean(totalErrors),
    moneyline: hitRate(rated.map((row) => row.mlHit)),
    favoriteWinRate: hitRate(modelFavHome.map((row) => row.mlHit)),
    dogWinRateWhenPicked: hitRate(modelFavAway.map((row) => row.mlHit === null ? null : !row.mlHit ? true : false)),
    atsVsMarket: hitRate([
      ...atsModelHome.map((row) => row.atsHomeHit),
      ...atsModelAway.map((row) => (row.atsHomeHit === null ? null : !row.atsHomeHit)),
    ]),
    totalsVsMarket: hitRate([
      ...overSide.map((row) => row.totalOverHit),
      ...underSide.map((row) => (row.totalOverHit === null ? null : !row.totalOverHit)),
    ]),
  };
}

function betsToHistorical(rows: ForecastRow[]): HistoricalBet[] {
  return rows
    .filter((row) => row.grade === "W" || row.grade === "L")
    .map((row) => ({
      p: row.p ?? 0.5,
      americanOdds: row.pickOdds ?? -110,
      won: row.grade === "W",
      betType: (row.pickType as HistoricalBet["betType"]) ?? undefined,
      edge: row.edge ?? undefined,
      evPerUnit: row.evPerUnit ?? undefined,
      week: 1,
      season: 2026,
      alignment: row.alignment ?? undefined,
    }));
}

async function main(): Promise<void> {
  const started = Date.now();
  process.stderr.write("Fetching 2024-2025 NCAAF history and 2026 Week 1 scores...\n");
  const [twoYearsAgo, prior, week1Raw] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: 2024, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year: 2025, includePostseason: true, maxWeek: 16 }),
    fetchEspnScoreboard({ league: "ncaaf", week: 1, seasonType: 2, year: 2026, limit: 300 }),
  ]);
  const history = attachRestDays(
    [...twoYearsAgo, ...prior].filter(isCompletedGame),
  );
  const week1Scores = week1Raw.filter(isCompletedGame);
  process.stderr.write(
    `History ${history.length} completed. Week 1 ${week1Scores.length} completed. Attaching closes...\n`,
  );
  const week1 = attachRestDays(await attachHistoricalClosingOdds(week1Scores, { concurrency: 8 }));
  const pricedCount = week1.filter((game) => game.market).length;
  process.stderr.write(`Week 1 games with closes: ${pricedCount}/${week1.length}\n`);

  const weekLevelRatings = fitTeamRatings(history, "ncaaf");
  const weekLevelRated = new Map(weekLevelRatings.map((row) => [row.team.id, row]));
  const weekLevelRows = week1
    .slice()
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso))
    .map((game) => toForecastRow(game, weekLevelRatings, weekLevelRated));

  const chronoRows: ForecastRow[] = [];
  const sortedWeek1 = week1.slice().sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));
  for (const [index, game] of sortedWeek1.entries()) {
    const priorWeek1 = sortedWeek1.slice(0, index);
    const ratings = fitTeamRatings([...history, ...priorWeek1], "ncaaf");
    const rated = new Map(ratings.map((row) => [row.team.id, row]));
    chronoRows.push(toForecastRow(game, ratings, rated));
  }

  const weekLevelBets = weekLevelRows.filter((row) => row.grade === "W" || row.grade === "L" || row.grade === "P");
  const chronoBets = chronoRows.filter((row) => row.grade === "W" || row.grade === "L" || row.grade === "P");
  const weekLevelAction = betsToHistorical(weekLevelRows);
  const chronoAction = betsToHistorical(chronoRows);

  const snapshot = await readSnapshot();
  const leftover = (snapshot?.ncaaf.board ?? [])
    .filter((row) => row.game.week === 1)
    .map((row) => {
      const result = week1.find((game) => game.id === row.game.id);
      if (!result) {
        return {
          matchup: `${row.game.away.abbreviation} @ ${row.game.home.abbreviation}`,
          storedPick: row.bestBet?.label ?? "SIT",
          grade: "MISSING" as const,
        };
      }
      const side = row.bestBet;
      if (!side) {
        return {
          matchup: `${result.away.abbreviation} @ ${result.home.abbreviation}`,
          storedPick: "SIT",
          score: `${result.awayScore}-${result.homeScore}`,
          grade: "SIT" as const,
          units: 0,
        };
      }
      const graded = gradeCompletedSide(side, { ...result, market: row.game.market ?? result.market });
      return {
        matchup: `${result.away.abbreviation} @ ${result.home.abbreviation}`,
        storedPick: side.label,
        storedOdds: side.americanOdds,
        p: side.handicappedP,
        score: `${result.awayScore}-${result.homeScore}`,
        market: row.game.market,
        grade: graded ?? "SIT",
        units: graded ? unitsFor(side, graded) : 0,
      };
    });

  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    league: "ncaaf",
    season: 2026,
    week: 1,
    notes: {
      policy: "Live book is NCAAF SRS + profit gate (no ML, alignment >= 0.8, edge >= 4%, EV <= 45%). NFL sat.",
      prices: "ESPN core closes (provider on snapshot-era Week 1 games is DraftKings).",
      weekLevel: "Ratings fit on 2024-2025 only. Matches walk-forward week W using week < W.",
      chronological: "Ratings updated after each completed 2026 Week 1 kickoff. Closer to a refreshed live desk.",
    },
    coverage: {
      week1Games: week1.length,
      withCloses: pricedCount,
      historyGames: history.length,
      snapshotGeneratedAt: snapshot?.generatedAt ?? null,
    },
    weekLevel: {
      book: recordFrom(weekLevelBets),
      backtest: weekLevelAction.length > 0 ? backtestFlat(weekLevelAction, 1) : null,
      byMarket: {
        spread: recordFrom(weekLevelBets.filter((row) => row.pickType === "spread")),
        total: recordFrom(weekLevelBets.filter((row) => row.pickType === "total")),
      },
      meanP: mean(weekLevelBets.filter((row) => row.p !== null).map((row) => row.p ?? 0)),
      projections: projectionSummary(weekLevelRows),
      sits: weekLevelRows.filter((row) => row.grade === "SIT").map((row) => row.matchup),
      unrated: weekLevelRows.filter((row) => row.grade === "UNRATED").length,
      noMarket: weekLevelRows.filter((row) => row.grade === "NO_MARKET").length,
      rows: weekLevelRows,
    },
    chronological: {
      book: recordFrom(chronoBets),
      backtest: chronoAction.length > 0 ? backtestFlat(chronoAction, 1) : null,
      byMarket: {
        spread: recordFrom(chronoBets.filter((row) => row.pickType === "spread")),
        total: recordFrom(chronoBets.filter((row) => row.pickType === "total")),
      },
      meanP: mean(chronoBets.filter((row) => row.p !== null).map((row) => row.p ?? 0)),
      projections: projectionSummary(chronoRows),
      rows: chronoRows,
    },
    snapshotLeftovers: leftover,
  };

  const outDir = path.join(process.cwd(), "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "week1-2026-grades.json");
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  process.stderr.write(`Wrote ${outPath} in ${payload.elapsedMs}ms\n`);

  const book = payload.weekLevel.book;
  const chrono = payload.chronological.book;
  console.log(
    JSON.stringify(
      {
        weekLevelBook: book,
        weekLevelByMarket: payload.weekLevel.byMarket,
        weekLevelMeanP: payload.weekLevel.meanP,
        weekLevelProjections: payload.weekLevel.projections,
        chronologicalBook: chrono,
        chronologicalByMarket: payload.chronological.byMarket,
        snapshotLeftovers: leftover,
        sits: payload.weekLevel.sits,
        bets: weekLevelBets.map((row) => ({
          kickoffIso: row.kickoffIso,
          matchup: row.matchup,
          pick: row.pickLabel,
          p: row.p,
          edge: row.edge,
          market: `${row.marketSpread}/${row.marketTotal}`,
          model: `${row.modelMargin.toFixed(1)}/${row.modelTotal.toFixed(1)}`,
          score: `${row.awayScore}-${row.homeScore}`,
          grade: row.grade,
          units: Number(row.units.toFixed(3)),
        })),
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
