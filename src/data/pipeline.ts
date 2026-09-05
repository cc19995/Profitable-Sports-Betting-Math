import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { backtestFlat, type HistoricalBet } from "@/src/lib/backtest";
import { handicapMatchup, isActionable } from "@/src/lib/matchup";
import { pickQuality, selectTrustedBestBet } from "@/src/lib/picks";
import { fitTeamRatings } from "@/src/lib/ratings";
import type { CompletedGame, League, UpcomingGame } from "@/src/lib/types";
import { attachRestDays, dedupeGames, fetchEspnScoreboard, fetchEspnSeason, isCompletedGame } from "./espn";
import { loadNflverseGames } from "./nflverse";
import { emptyLeagueSnapshot, type LeagueSnapshot, type ModelSnapshot } from "./snapshot";

function snapshotPath(): string {
  return path.join(process.cwd(), "data", "snapshot.json");
}

function upcomingOnly(games: Array<CompletedGame | UpcomingGame>): UpcomingGame[] {
  return games.filter((game) => !isCompletedGame(game));
}

function completedOnly(games: Array<CompletedGame | UpcomingGame>): CompletedGame[] {
  return games.filter(isCompletedGame);
}

function preferEspnOdds(primary: UpcomingGame[], live: UpcomingGame[]): UpcomingGame[] {
  const byKey = new Map<string, UpcomingGame>();
  for (const game of live) {
    byKey.set(`${game.home.abbreviation}@${game.away.abbreviation}@${game.kickoffIso.slice(0, 10)}`, game);
    byKey.set(`${game.away.abbreviation}@${game.home.abbreviation}@${game.kickoffIso.slice(0, 10)}`, game);
  }
  return primary.map((game) => {
    const match =
      byKey.get(`${game.home.abbreviation}@${game.away.abbreviation}@${game.kickoffIso.slice(0, 10)}`) ??
      live.find(
        (row) =>
          row.home.abbreviation === game.home.abbreviation &&
          row.away.abbreviation === game.away.abbreviation,
      );
    if (!match?.market) {
      return game;
    }
    return { ...game, market: match.market, venueName: match.venueName, indoor: match.indoor };
  });
}

function hasLiveMarket(game: UpcomingGame): boolean {
  const market = game.market;
  if (!market) {
    return false;
  }
  return market.homeMoneyline !== undefined || market.homeSpread !== undefined || market.total !== undefined;
}

function isNearTerm(game: UpcomingGame, nowMs = Date.now()): boolean {
  const kick = Date.parse(game.kickoffIso);
  if (!Number.isFinite(kick)) {
    return false;
  }
  const earliest = nowMs - 12 * 60 * 60 * 1000;
  const latest = nowMs + 18 * 24 * 60 * 60 * 1000;
  return kick >= earliest && kick <= latest;
}

function buildBoard(args: {
  league: League;
  upcoming: UpcomingGame[];
  completed: CompletedGame[];
}): LeagueSnapshot {
  const ratings = fitTeamRatings(args.completed, args.league);
  const rated = new Map(ratings.map((row) => [row.team.id, row]));
  const minGames = args.league === "nfl" ? 8 : 6;
  const board = args.upcoming
    .filter((game) => {
      const home = rated.get(game.home.id);
      const away = rated.get(game.away.id);
      return Boolean(
        home &&
        away &&
        home.games >= minGames &&
        away.games >= minGames &&
        hasLiveMarket(game) &&
        isNearTerm(game),
      );
    })
    .map((game) => {
      const report = handicapMatchup({ game, ratings });
      const row = {
        game,
        report,
        bestBet: null,
      };
      return {
        game,
        report,
        bestBet: selectTrustedBestBet(row),
      };
    })
    .sort((a, b) => {
      const aq = a.bestBet ? pickQuality(a, a.bestBet) : -1;
      const bq = b.bestBet ? pickQuality(b, b.bestBet) : -1;
      return bq - aq;
    });

  return {
    league: args.league,
    ratings,
    board,
    completedCount: args.completed.length,
    upcomingCount: board.length,
  };
}

function walkForwardBets(completed: CompletedGame[], league: League): HistoricalBet[] {
  const sorted = completed
    .slice()
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso) || a.week - b.week);
  const bets: HistoricalBet[] = [];
  const seasons = [...new Set(sorted.map((game) => game.season))].sort((a, b) => a - b);
  let holdoutSeason = seasons[seasons.length - 1];
  if (holdoutSeason === undefined) {
    return bets;
  }
  const previousSeason = seasons[seasons.length - 2];
  if (
    previousSeason !== undefined &&
    sorted.filter((game) => game.season === holdoutSeason).length < 64
  ) {
    holdoutSeason = previousSeason;
  }
  const prior = sorted.filter((game) => game.season < holdoutSeason);
  const holdout = sorted.filter((game) => game.season === holdoutSeason);
  const weeks = [...new Set(holdout.map((game) => game.week))].sort((a, b) => a - b);

  for (const week of weeks) {
    const history = [...prior, ...holdout.filter((game) => game.week < week)];
    if (history.length < 32) {
      continue;
    }
    const ratings = fitTeamRatings(history, league);
    const rated = new Set(ratings.map((row) => row.team.id));
    for (const game of holdout.filter((row) => row.week === week)) {
      if (!rated.has(game.home.id) || !rated.has(game.away.id) || !game.market) {
        continue;
      }
      const upcoming: UpcomingGame = { ...game };
      const report = handicapMatchup({ game: upcoming, ratings });
      const plus = report.priced.filter((side) =>
        isActionable(side, game.market, report.projection.margin, report.projection.total, league),
      );
      const side = plus.sort((a, b) => b.evPerUnit - a.evPerUnit)[0];
      if (!side) {
        continue;
      }
      let won = false;
      if (side.betType === "moneyline") {
        won = side.side === "home" ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
      } else if (side.betType === "spread" && game.market.homeSpread !== undefined) {
        const margin = game.homeScore - game.awayScore;
        won = side.side === "home" ? margin + game.market.homeSpread > 0 : -(margin + game.market.homeSpread) > 0;
      } else if (side.betType === "total" && game.market.total !== undefined) {
        const total = game.homeScore + game.awayScore;
        won = side.side === "over" ? total > game.market.total : total < game.market.total;
      } else {
        continue;
      }
      bets.push({ p: side.handicappedP, americanOdds: side.americanOdds, won });
    }
  }
  return bets;
}

export async function refreshNfl(): Promise<LeagueSnapshot> {
  const year = new Date().getUTCFullYear();
  const nflverse = await loadNflverseGames([year - 2, year - 1, year]);
  let espnLive: Array<CompletedGame | UpcomingGame> = [];
  try {
    espnLive = await fetchEspnScoreboard({ league: "nfl", week: 1, seasonType: 2, year });
    const more = await fetchEspnScoreboard({ league: "nfl" });
    espnLive = dedupeGames([...espnLive, ...more]);
  } catch (error) {
    console.warn("ESPN NFL live odds unavailable:", error instanceof Error ? error.message : error);
  }
  const completed = completedOnly(nflverse);
  const upcoming = preferEspnOdds(upcomingOnly(nflverse), upcomingOnly(espnLive));
  const snapshot = buildBoard({ league: "nfl", upcoming, completed });
  const bets = walkForwardBets(completed, "nfl");
  if (bets.length >= 20) {
    snapshot.backtest = backtestFlat(bets, 1);
  }
  return snapshot;
}

export async function refreshNcaaf(): Promise<LeagueSnapshot> {
  const year = new Date().getUTCFullYear();
  const prior = await fetchEspnSeason({ league: "ncaaf", year: year - 1, includePostseason: true });
  let current: Array<CompletedGame | UpcomingGame> = [];
  try {
    current = await fetchEspnSeason({ league: "ncaaf", year, maxWeek: 3, includePostseason: false });
    const live = await fetchEspnScoreboard({ league: "ncaaf" });
    current = dedupeGames([...current, ...live]);
  } catch (error) {
    console.warn("ESPN NCAAF current season unavailable:", error instanceof Error ? error.message : error);
  }
  const all = attachRestDays(dedupeGames([...prior, ...current]));
  const snapshot = buildBoard({
    league: "ncaaf",
    upcoming: upcomingOnly(all),
    completed: completedOnly(all),
  });
  const bets = walkForwardBets(completedOnly(all).filter((game) => game.season === year - 1 || game.season === year), "ncaaf");
  if (bets.length >= 20) {
    snapshot.backtest = backtestFlat(bets, 1);
  }
  return snapshot;
}

export async function refreshAll(): Promise<ModelSnapshot> {
  const [nfl, ncaaf] = await Promise.all([
    refreshNfl().catch((error: unknown) => {
      console.warn("NFL refresh failed:", error instanceof Error ? error.message : error);
      return emptyLeagueSnapshot("nfl");
    }),
    refreshNcaaf().catch((error: unknown) => {
      console.warn("NCAAF refresh failed:", error instanceof Error ? error.message : error);
      return emptyLeagueSnapshot("ncaaf");
    }),
  ]);
  const snapshot: ModelSnapshot = {
    generatedAt: new Date().toISOString(),
    nfl,
    ncaaf,
  };
  await mkdir(path.dirname(snapshotPath()), { recursive: true });
  await writeFile(snapshotPath(), JSON.stringify(snapshot));
  return snapshot;
}
