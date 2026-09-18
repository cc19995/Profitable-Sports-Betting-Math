import { getLeagueConstants } from "./league";
import { assertFiniteNumber } from "./odds";
import type { League, MatchupAdjustments } from "./types";

const MAX_ABS_ADJ = 14;

function bounded(value: number, name: string): number {
  const n = assertFiniteNumber(value, name);
  if (Math.abs(n) > MAX_ABS_ADJ) {
    throw new Error(`${name} adjustment is implausibly large`);
  }
  return n;
}

export function restAdjustment(homeRestDays: number | undefined, awayRestDays: number | undefined): number {
  if (homeRestDays === undefined || awayRestDays === undefined) {
    return 0;
  }
  const home = assertFiniteNumber(homeRestDays, "homeRestDays");
  const away = assertFiniteNumber(awayRestDays, "awayRestDays");
  if (home < 0 || away < 0) {
    throw new Error("rest days cannot be negative");
  }
  const delta = home - away;
  if (Math.abs(delta) < 1) {
    return 0;
  }
  const sign = delta > 0 ? 1 : -1;
  const extra = Math.abs(delta);
  if (extra >= 6) {
    return sign * 1.4;
  }
  if (extra >= 3) {
    return sign * 0.8;
  }
  return sign * 0.35;
}

export function weatherTotalAdjustment(args: {
  windMph?: number;
  indoor?: boolean;
  roof?: string;
}): number {
  if (args.indoor || args.roof === "dome" || args.roof === "closed") {
    return 0;
  }
  const wind = args.windMph;
  if (wind === undefined) {
    return 0;
  }
  const mph = assertFiniteNumber(wind, "windMph");
  if (mph < 0) {
    throw new Error("windMph cannot be negative");
  }
  if (mph < 12) {
    return 0;
  }
  return -0.18 * (mph - 10);
}

export function buildAdjustments(args: {
  league: League;
  neutralSite?: boolean;
  homeRestDays?: number;
  awayRestDays?: number;
  windMph?: number;
  indoor?: boolean;
  roof?: string;
  qbHome?: number;
  qbAway?: number;
  userHome?: number;
  userAway?: number;
}): MatchupAdjustments {
  const constants = getLeagueConstants(args.league);
  return {
    homeField: args.neutralSite ? 0 : constants.homeFieldAdvantage,
    rest: restAdjustment(args.homeRestDays, args.awayRestDays),
    weatherTotal: weatherTotalAdjustment({
      windMph: args.windMph,
      indoor: args.indoor,
      roof: args.roof,
    }),
    qbHome: bounded(args.qbHome ?? 0, "qbHome"),
    qbAway: bounded(args.qbAway ?? 0, "qbAway"),
    userHome: bounded(args.userHome ?? 0, "userHome"),
    userAway: bounded(args.userAway ?? 0, "userAway"),
  };
}
