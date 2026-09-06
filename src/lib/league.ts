import type { League, LeagueConstants } from "./types";

/**
 * Principle-driven constants, not fit to last week's losers.
 * NFL HFA / sigma estimated on 2015-2023 regular+postseason home games
 * (mean home margin 1.87, raw margin SD 14.1). Model sigma is slightly
 * tighter than raw SD but looser than closing-line residual (~12.7) so
 * we do not pretend to be as sharp as the market.
 */
export const LEAGUE_CONSTANTS: Record<League, LeagueConstants> = {
  nfl: {
    league: "nfl",
    homeFieldAdvantage: 1.9,
    marginSigma: 13.8,
    totalSigma: 13.5,
    averageTeamScore: 22.8,
    priorRetention: 0.65,
    recencyHalfLifeGames: 6,
    shrinkageK: 4,
  },
  ncaaf: {
    league: "ncaaf",
    homeFieldAdvantage: 2.6,
    marginSigma: 17.4,
    totalSigma: 16.8,
    averageTeamScore: 27.2,
    priorRetention: 0.7,
    recencyHalfLifeGames: 8,
    shrinkageK: 2,
  },
};

export function getLeagueConstants(league: League): LeagueConstants {
  const constants = LEAGUE_CONSTANTS[league];
  if (!constants) {
    throw new Error(`unsupported league: ${String(league)}`);
  }
  return constants;
}

export function isLeague(value: string): value is League {
  return value === "nfl" || value === "ncaaf";
}
