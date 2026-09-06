import { backtestFlat, type HistoricalBet } from "./backtest";
import { handicapMatchup, isActionable } from "./matchup";
import { alignmentScore, selectProfitBestBet, selectTrustedBestBet } from "./picks";
import { fitTeamRatings } from "./ratings";
import type { BacktestSummary, CompletedGame, League, PricedSide, UpcomingGame } from "./types";

export type WalkForwardPick = "trusted" | "maxActionableEv" | "profit";

export type WalkForwardOptions = {
  holdoutSeason: number;
  minHistory?: number;
  minTeamGames?: number;
  pick?: WalkForwardPick;
};

export type SideResult = "W" | "L" | "P";

export function inferHoldoutSeason(completed: CompletedGame[]): number | undefined {
  const seasons = [...new Set(completed.map((game) => game.season))].sort((a, b) => a - b);
  let holdoutSeason = seasons[seasons.length - 1];
  if (holdoutSeason === undefined) {
    return undefined;
  }
  const previousSeason = seasons[seasons.length - 2];
  if (previousSeason !== undefined && completed.filter((game) => game.season === holdoutSeason).length < 64) {
    return previousSeason;
  }
  return holdoutSeason;
}

export function gradeCompletedSide(side: PricedSide, game: CompletedGame): SideResult | null {
  if (side.betType === "moneyline") {
    if (game.homeScore === game.awayScore) {
      return "P";
    }
    const homeWon = game.homeScore > game.awayScore;
    return side.side === "home" ? (homeWon ? "W" : "L") : homeWon ? "L" : "W";
  }
  if (side.betType === "spread") {
    const line = game.market?.homeSpread;
    if (line === undefined) {
      return null;
    }
    const adj = game.homeScore - game.awayScore + line;
    if (adj === 0) {
      return "P";
    }
    const homeCovered = adj > 0;
    return side.side === "home" ? (homeCovered ? "W" : "L") : homeCovered ? "L" : "W";
  }
  const totalLine = game.market?.total;
  if (totalLine === undefined) {
    return null;
  }
  const pts = game.homeScore + game.awayScore;
  if (pts === totalLine) {
    return "P";
  }
  const wentOver = pts > totalLine;
  return side.side === "over" ? (wentOver ? "W" : "L") : wentOver ? "L" : "W";
}

function pickSide(args: {
  game: CompletedGame;
  league: League;
  ratings: ReturnType<typeof fitTeamRatings>;
  pick: WalkForwardPick;
}): { side: PricedSide; alignment: number } | null {
  const upcoming: UpcomingGame = { ...args.game };
  const report = handicapMatchup({ game: upcoming, ratings: args.ratings });
  const row = { game: upcoming, report, bestBet: null };
  const side =
    args.pick === "profit"
      ? selectProfitBestBet(row)
      : args.pick === "trusted"
        ? selectTrustedBestBet(row)
        : (report.priced
            .filter((priced) =>
              isActionable(
                priced,
                args.game.market,
                report.projection.margin,
                report.projection.total,
                args.league,
              ),
            )
            .sort((a, b) => b.evPerUnit - a.evPerUnit)[0] ?? null);
  if (!side) {
    return null;
  }
  return { side, alignment: alignmentScore(row, side) };
}

export function walkForwardBets(
  completed: CompletedGame[],
  league: League,
  options: WalkForwardOptions,
): HistoricalBet[] {
  const minHistory = options.minHistory ?? 32;
  const minTeamGames = options.minTeamGames ?? (league === "nfl" ? 8 : 6);
  const pick = options.pick ?? "trusted";
  const sorted = completed
    .slice()
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso) || a.week - b.week);
  const prior = sorted.filter((game) => game.season < options.holdoutSeason);
  const holdout = sorted.filter((game) => game.season === options.holdoutSeason);
  const weeks = [...new Set(holdout.map((game) => game.week))].sort((a, b) => a - b);
  const bets: HistoricalBet[] = [];

  for (const week of weeks) {
    const history = [...prior, ...holdout.filter((game) => game.week < week)];
    if (history.length < minHistory) {
      continue;
    }
    const ratings = fitTeamRatings(history, league);
    const rated = new Map(ratings.map((row) => [row.team.id, row]));
    for (const game of holdout.filter((row) => row.week === week)) {
      const home = rated.get(game.home.id);
      const away = rated.get(game.away.id);
      if (!home || !away || home.games < minTeamGames || away.games < minTeamGames || !game.market) {
        continue;
      }
      const picked = pickSide({ game, league, ratings, pick });
      if (!picked) {
        continue;
      }
      const result = gradeCompletedSide(picked.side, game);
      if (result === null || result === "P") {
        continue;
      }
      bets.push({
        p: picked.side.handicappedP,
        americanOdds: picked.side.americanOdds,
        won: result === "W",
        betType: picked.side.betType,
        edge: picked.side.edge,
        evPerUnit: picked.side.evPerUnit,
        week: game.week,
        season: game.season,
        alignment: picked.alignment,
      });
    }
  }
  return bets;
}

export function summarizeWalkForward(
  bets: HistoricalBet[],
  extras: { holdoutSeason: number; pickRule: string },
): BacktestSummary | undefined {
  if (bets.length < 20) {
    return undefined;
  }
  return {
    ...backtestFlat(bets, 1),
    holdoutSeason: extras.holdoutSeason,
    pickRule: extras.pickRule,
  };
}
