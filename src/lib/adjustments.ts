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
  windGustMph?: number;
  indoor?: boolean;
  roof?: string;
  precipProbability?: number;
  precipMm?: number;
  snowfallCm?: number;
  temperatureF?: number;
}): number {
  if (args.indoor || args.roof === "dome" || args.roof === "closed") {
    return 0;
  }
  let total = 0;
  const wind = args.windMph;
  if (wind !== undefined) {
    const mph = assertFiniteNumber(wind, "windMph");
    if (mph < 0) {
      throw new Error("windMph cannot be negative");
    }
    if (mph >= 12) {
      total += -0.18 * (mph - 10);
    }
  }
  const gust = args.windGustMph;
  if (gust !== undefined) {
    const gustMph = assertFiniteNumber(gust, "windGustMph");
    if (gustMph < 0) {
      throw new Error("windGustMph cannot be negative");
    }
    const sustained = args.windMph ?? 0;
    if (gustMph >= 20 && gustMph - sustained >= 10) {
      total += -0.08 * (gustMph - 15);
    }
  }
  const precipProb = args.precipProbability;
  const precipMm = args.precipMm;
  if (precipProb !== undefined) {
    assertFiniteNumber(precipProb, "precipProbability");
  }
  if (precipMm !== undefined) {
    assertFiniteNumber(precipMm, "precipMm");
  }
  if ((precipProb ?? 0) >= 50 && (precipMm ?? 0) >= 0.5) {
    total -= 1;
  }
  if ((precipProb ?? 0) >= 70 && (precipMm ?? 0) >= 2) {
    total -= 1.2;
  }
  const snow = args.snowfallCm;
  if (snow !== undefined) {
    const cm = assertFiniteNumber(snow, "snowfallCm");
    if (cm < 0) {
      throw new Error("snowfallCm cannot be negative");
    }
    if (cm >= 0.5) {
      total -= 2;
    }
    if (cm >= 2) {
      total -= 1.5;
    }
  }
  const temp = args.temperatureF;
  if (temp !== undefined) {
    const f = assertFiniteNumber(temp, "temperatureF");
    if (f <= 20) {
      total -= 1.5;
    } else if (f <= 32) {
      total -= 0.6;
    }
  }
  return Math.max(-8, total);
}

export function buildAdjustments(args: {
  league: League;
  neutralSite?: boolean;
  homeRestDays?: number;
  awayRestDays?: number;
  windMph?: number;
  windGustMph?: number;
  indoor?: boolean;
  roof?: string;
  precipProbability?: number;
  precipMm?: number;
  snowfallCm?: number;
  temperatureF?: number;
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
      windGustMph: args.windGustMph,
      indoor: args.indoor,
      roof: args.roof,
      precipProbability: args.precipProbability,
      precipMm: args.precipMm,
      snowfallCm: args.snowfallCm,
      temperatureF: args.temperatureF,
    }),
    qbHome: bounded(args.qbHome ?? 0, "qbHome"),
    qbAway: bounded(args.qbAway ?? 0, "qbAway"),
    userHome: bounded(args.userHome ?? 0, "userHome"),
    userAway: bounded(args.userAway ?? 0, "userAway"),
  };
}
