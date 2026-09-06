import type { HouseModel, TeamFactors } from "@/src/lib/rithmm/types";
import type {
  BacktestSummary,
  BoardRow,
  League,
  TeamRating,
  UpcomingGame,
} from "@/src/lib/types";

export interface LeagueSnapshot {
  league: League;
  ratings: TeamRating[];
  board: BoardRow[];
  completedCount: number;
  upcomingCount: number;
  backtest?: BacktestSummary;
  factorBook?: TeamFactors[];
  houseModel?: HouseModel;
}

export interface ModelSnapshot {
  generatedAt: string;
  nfl: LeagueSnapshot;
  ncaaf: LeagueSnapshot;
}

export function emptyLeagueSnapshot(league: League): LeagueSnapshot {
  return {
    league,
    ratings: [],
    board: [],
    completedCount: 0,
    upcomingCount: 0,
  };
}

export function findUpcoming(snapshot: ModelSnapshot, league: League, gameId: string): UpcomingGame | undefined {
  const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  return pack.board.find((row) => row.game.id === gameId)?.game;
}
