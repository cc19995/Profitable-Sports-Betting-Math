import { getLeagueConstants } from "./league";
import { assertFiniteNumber } from "./odds";
import { pythagoreanWins } from "./processMatchup";
import type { CompletedGame, League, TeamRating, TeamRef } from "./types";

const MAX_ITERATIONS = 40;
const TOLERANCE = 1e-4;

interface InternalRating {
  team: TeamRef;
  offense: number;
  defense: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  residual: number;
  residualGames: number;
  last4: number[];
  homeResidual: number;
  homeGames: number;
  awayResidual: number;
  awayGames: number;
  opponentNet: number;
  wins: number;
  oneScoreWins: number;
  oneScoreGames: number;
}

function gameWeight(gamesAgo: number, halfLife: number): number {
  if (halfLife <= 0) {
    throw new Error("halfLife must be positive");
  }
  return Math.pow(0.5, gamesAgo / halfLife);
}

function shrink(raw: number, n: number, k: number): number {
  return (n / (n + k)) * raw;
}

export function fitTeamRatings(games: CompletedGame[], league: League): TeamRating[] {
  if (!Array.isArray(games)) {
    throw new Error("games must be an array");
  }
  const constants = getLeagueConstants(league);
  const leagueGames = games
    .filter((game) => game.league === league && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore))
    .slice()
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));

  const teams = new Map<string, InternalRating>();
  const ensure = (ref: TeamRef): InternalRating => {
    const existing = teams.get(ref.id);
    if (existing) {
      return existing;
    }
    const created: InternalRating = {
      team: ref,
      offense: 0,
      defense: 0,
      games: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      residual: 0,
      residualGames: 0,
      last4: [],
      homeResidual: 0,
      homeGames: 0,
      awayResidual: 0,
      awayGames: 0,
      opponentNet: 0,
      wins: 0,
      oneScoreWins: 0,
      oneScoreGames: 0,
    };
    teams.set(ref.id, created);
    return created;
  };

  for (const game of leagueGames) {
    ensure(game.home);
    ensure(game.away);
  }

  const seasons = [...new Set(leagueGames.map((game) => game.season))].sort((a, b) => a - b);
  const latestSeason = seasons[seasons.length - 1] ?? 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const nextOff = new Map<string, { sum: number; weight: number }>();
    const nextDef = new Map<string, { sum: number; weight: number }>();
    const bump = (map: Map<string, { sum: number; weight: number }>, id: string, value: number, weight: number) => {
      const cur = map.get(id) ?? { sum: 0, weight: 0 };
      cur.sum += value * weight;
      cur.weight += weight;
      map.set(id, cur);
    };

    const gamesAgoByTeam = new Map<string, number>();
    for (let i = leagueGames.length - 1; i >= 0; i -= 1) {
      const game = leagueGames[i];
      if (!game) {
        continue;
      }
      const homeAgo = gamesAgoByTeam.get(`${game.season}:${game.home.id}`) ?? 0;
      const awayAgo = gamesAgoByTeam.get(`${game.season}:${game.away.id}`) ?? 0;
      gamesAgoByTeam.set(`${game.season}:${game.home.id}`, homeAgo + 1);
      gamesAgoByTeam.set(`${game.season}:${game.away.id}`, awayAgo + 1);

      const home = teams.get(game.home.id);
      const away = teams.get(game.away.id);
      if (!home || !away) {
        continue;
      }
      const hfa = game.neutralSite ? 0 : constants.homeFieldAdvantage;
      const seasonDecay = Math.pow(constants.priorRetention, Math.max(0, latestSeason - game.season));
      const homeRecency = game.season === latestSeason ? gameWeight(homeAgo, constants.recencyHalfLifeGames) : 1;
      const awayRecency = game.season === latestSeason ? gameWeight(awayAgo, constants.recencyHalfLifeGames) : 1;
      const homeWeight = homeRecency * seasonDecay;
      const awayWeight = awayRecency * seasonDecay;

      const homeOffObs = game.homeScore - constants.averageTeamScore + away.defense - hfa;
      const awayOffObs = game.awayScore - constants.averageTeamScore + home.defense;
      const homeDefObs = constants.averageTeamScore + away.offense - game.awayScore;
      const awayDefObs = constants.averageTeamScore + home.offense + hfa - game.homeScore;

      bump(nextOff, home.team.id, homeOffObs, homeWeight);
      bump(nextOff, away.team.id, awayOffObs, awayWeight);
      bump(nextDef, home.team.id, homeDefObs, homeWeight);
      bump(nextDef, away.team.id, awayDefObs, awayWeight);
    }

    let maxDelta = 0;
    for (const team of teams.values()) {
      const offAcc = nextOff.get(team.team.id);
      const defAcc = nextDef.get(team.team.id);
      const offRaw = offAcc && offAcc.weight > 0 ? offAcc.sum / offAcc.weight : 0;
      const defRaw = defAcc && defAcc.weight > 0 ? defAcc.sum / defAcc.weight : 0;
      const off = shrink(offRaw, offAcc?.weight ?? 0, constants.shrinkageK);
      const def = shrink(defRaw, defAcc?.weight ?? 0, constants.shrinkageK);
      maxDelta = Math.max(maxDelta, Math.abs(off - team.offense), Math.abs(def - team.defense));
      team.offense = off;
      team.defense = def;
    }
    if (maxDelta < TOLERANCE) {
      break;
    }
  }

  const gamesAgoByTeam = new Map<string, number>();
  for (let i = leagueGames.length - 1; i >= 0; i -= 1) {
    const game = leagueGames[i];
    if (!game) {
      continue;
    }
    const home = teams.get(game.home.id);
    const away = teams.get(game.away.id);
    if (!home || !away) {
      continue;
    }
    const hfa = game.neutralSite ? 0 : constants.homeFieldAdvantage;
    const expectedHome = constants.averageTeamScore + home.offense - away.defense + hfa;
    const expectedAway = constants.averageTeamScore + away.offense - home.defense;
    const residualHome = game.homeScore - game.awayScore - (expectedHome - expectedAway);

    home.games += 1;
    away.games += 1;
    home.pointsFor += game.homeScore;
    home.pointsAgainst += game.awayScore;
    away.pointsFor += game.awayScore;
    away.pointsAgainst += game.homeScore;
    home.residual += residualHome;
    away.residual -= residualHome;
    home.residualGames += 1;
    away.residualGames += 1;
    home.opponentNet += away.offense + away.defense;
    away.opponentNet += home.offense + home.defense;
    home.homeResidual += residualHome;
    home.homeGames += 1;
    away.awayResidual -= residualHome;
    away.awayGames += 1;

    if (game.homeScore > game.awayScore) {
      home.wins += 1;
    } else if (game.awayScore > game.homeScore) {
      away.wins += 1;
    }
    const absMargin = Math.abs(game.homeScore - game.awayScore);
    if (absMargin > 0 && absMargin <= 8) {
      home.oneScoreGames += 1;
      away.oneScoreGames += 1;
      if (game.homeScore > game.awayScore) {
        home.oneScoreWins += 1;
      } else {
        away.oneScoreWins += 1;
      }
    }

    const homeAgo = gamesAgoByTeam.get(home.team.id) ?? 0;
    const awayAgo = gamesAgoByTeam.get(away.team.id) ?? 0;
    if (homeAgo < 4) {
      home.last4.push(residualHome);
    }
    if (awayAgo < 4) {
      away.last4.push(-residualHome);
    }
    gamesAgoByTeam.set(home.team.id, homeAgo + 1);
    gamesAgoByTeam.set(away.team.id, awayAgo + 1);
  }

  const ratings: TeamRating[] = [];
  for (const team of teams.values()) {
    ratings.push({
      team: team.team,
      offense: team.offense,
      defense: team.defense,
      net: team.offense + team.defense,
      games: team.games,
      sos: team.games > 0 ? team.opponentNet / team.games : 0,
      avgPointsFor: team.games > 0 ? team.pointsFor / team.games : 0,
      avgPointsAgainst: team.games > 0 ? team.pointsAgainst / team.games : 0,
      residualMargin: team.residualGames > 0 ? team.residual / team.residualGames : 0,
      last4Residual: team.last4.length > 0 ? team.last4.reduce((a, b) => a + b, 0) / team.last4.length : 0,
      homeResidual: team.homeGames > 0 ? team.homeResidual / team.homeGames : 0,
      awayResidual: team.awayGames > 0 ? team.awayResidual / team.awayGames : 0,
      wins: team.wins,
      pythagoreanWins: pythagoreanWins(team.pointsFor, team.pointsAgainst, team.games),
      oneScoreWins: team.oneScoreWins,
      oneScoreGames: team.oneScoreGames,
    });
  }

  return ratings.sort((a, b) => b.net - a.net);
}

export function ratingById(ratings: TeamRating[], teamId: string): TeamRating {
  if (typeof teamId !== "string" || teamId.length === 0) {
    throw new Error("teamId is required");
  }
  const found = ratings.find((row) => row.team.id === teamId || row.team.abbreviation === teamId);
  if (!found) {
    throw new Error(`no rating for team ${teamId}`);
  }
  return found;
}

export function expectedScores(args: {
  home: TeamRating;
  away: TeamRating;
  league: League;
  neutralSite?: boolean;
  restAdjustment?: number;
  weatherTotalAdjustment?: number;
  qbHome?: number;
  qbAway?: number;
  userHome?: number;
  userAway?: number;
}): { homeScore: number; awayScore: number } {
  const constants = getLeagueConstants(args.league);
  const hfa = args.neutralSite ? 0 : constants.homeFieldAdvantage;
  const rest = args.restAdjustment ?? 0;
  const weather = args.weatherTotalAdjustment ?? 0;
  const qbHome = args.qbHome ?? 0;
  const qbAway = args.qbAway ?? 0;
  const userHome = args.userHome ?? 0;
  const userAway = args.userAway ?? 0;
  for (const [name, value] of [
    ["rest", rest],
    ["weather", weather],
    ["qbHome", qbHome],
    ["qbAway", qbAway],
    ["userHome", userHome],
    ["userAway", userAway],
  ] as const) {
    assertFiniteNumber(value, name);
  }

  const homeScore =
    constants.averageTeamScore +
    args.home.offense -
    args.away.defense +
    hfa +
    rest / 2 +
    weather / 2 +
    qbHome +
    userHome;
  const awayScore =
    constants.averageTeamScore +
    args.away.offense -
    args.home.defense -
    rest / 2 +
    weather / 2 +
    qbAway +
    userAway;
  return { homeScore, awayScore };
}
