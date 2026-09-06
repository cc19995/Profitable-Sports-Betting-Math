import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pickQuality, selectTrustedBestBet } from "@/src/lib/picks";
import { fitTeamRatings } from "@/src/lib/ratings";
import { inferHoldoutSeason, summarizeWalkForward, walkForwardBets } from "@/src/lib/walkForward";
import { handicapMatchup } from "@/src/lib/matchup";
import type { CompletedGame, League, UpcomingGame } from "@/src/lib/types";
import { attachRestDays, dedupeGames, fetchEspnScoreboard, fetchEspnSeason, isCompletedGame } from "./espn";
import { attachHistoricalClosingOdds } from "./espnOdds";
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
  const holdoutSeason = inferHoldoutSeason(completed);
  if (holdoutSeason !== undefined) {
    snapshot.backtest = summarizeWalkForward(
      walkForwardBets(completed, "nfl", { holdoutSeason, pick: "profit" }),
      { holdoutSeason, pickRule: "profit-best-bet" },
    );
  }
  return snapshot;
}

export async function refreshNcaaf(): Promise<LeagueSnapshot> {
  const year = new Date().getUTCFullYear();
  const holdoutSeason = year - 1;
  const [twoYearsAgo, prior] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: year - 2, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year: holdoutSeason, includePostseason: true, maxWeek: 16 }),
  ]);
  let current: Array<CompletedGame | UpcomingGame> = [];
  try {
    current = await fetchEspnSeason({ league: "ncaaf", year, maxWeek: 3, includePostseason: false });
    const live = await fetchEspnScoreboard({ league: "ncaaf" });
    current = dedupeGames([...current, ...live]);
  } catch (error) {
    console.warn("ESPN NCAAF current season unavailable:", error instanceof Error ? error.message : error);
  }
  const holdoutPriced = await attachHistoricalClosingOdds(completedOnly(prior));
  const all = attachRestDays(dedupeGames([...twoYearsAgo, ...holdoutPriced, ...current]));
  const snapshot = buildBoard({
    league: "ncaaf",
    upcoming: upcomingOnly(all),
    completed: completedOnly(all),
  });
  snapshot.backtest = summarizeWalkForward(
    walkForwardBets(completedOnly(all), "ncaaf", {
      holdoutSeason,
      pick: "profit",
      minTeamGames: 6,
    }),
    { holdoutSeason, pickRule: "profit-best-bet" },
  );
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
