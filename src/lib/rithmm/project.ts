import { getLeagueConstants } from "../league";
import type { League, MatchupAdjustments } from "../types";
import { getHouseModel, normalizeWeights } from "./house";
import { scoreToZ } from "./normalize";
import type { HouseWeights, TeamFactors } from "./types";

export function projectHouseScores(args: {
  home: TeamFactors;
  away: TeamFactors;
  league: League;
  adjustments: MatchupAdjustments;
  weights?: HouseWeights;
}): { homeScore: number; awayScore: number; engine: "house-epa" } {
  const model = getHouseModel(args.league);
  const weights = normalizeWeights(args.weights ?? model.weights);
  const constants = getLeagueConstants(args.league);
  const scale = model.pointsPerSigma;
  const hfa = args.adjustments.homeField;
  const rest = args.adjustments.rest;
  const weather = args.adjustments.weatherTotal;
  const qbHome = args.adjustments.qbHome;
  const qbAway = args.adjustments.qbAway;
  const userHome = args.adjustments.userHome;
  const userAway = args.adjustments.userAway;

  const passZ = scoreToZ(args.home.passing.offense) - scoreToZ(args.away.passing.defense);
  const runZ = scoreToZ(args.home.running.offense) - scoreToZ(args.away.running.defense);
  const offZ = scoreToZ(args.home.offense) - scoreToZ(args.away.defense);
  const defZ = scoreToZ(args.home.defense) - scoreToZ(args.away.offense);
  const rankZ = scoreToZ(args.home.ranks) - scoreToZ(args.away.ranks);

  const talentMargin =
    scale *
    (weights.passing * passZ +
      weights.running * runZ +
      weights.offense * offZ +
      weights.defense * defZ +
      weights.ranks * rankZ);

  const margin = talentMargin + hfa + rest + qbHome - qbAway + userHome - userAway;

  const leaguePace = args.league === "nfl" ? 62 : 72;
  const pace = (args.home.pace + args.away.pace) / 2;
  const tempo = Number.isFinite(pace) && pace > 0 ? (pace / leaguePace - 1) * (args.league === "nfl" ? 3.5 : 5.5) : 0;
  const scoringEnv =
    scale *
    0.32 *
    (scoreToZ(args.home.offense) +
      scoreToZ(args.away.offense) -
      scoreToZ(args.home.defense) -
      scoreToZ(args.away.defense));
  const total = 2 * constants.averageTeamScore + tempo + weather + scoringEnv;

  return {
    homeScore: (total + margin) / 2,
    awayScore: (total - margin) / 2,
    engine: "house-epa",
  };
}
