import { assertFiniteNumber } from "./odds";
import { fitTeamRatings } from "./ratings";
import type { CompletedGame, TeamRating } from "./types";

/**
 * Live NCAAF continuity: blend last season's SRS with this season's
 * shrunk observation. New head coaches drop the school-id prior.
 * Walk-forward still uses fitTeamRatings with default constants.
 */
export const NCAAF_CONTINUITY = {
  newHeadCoachLambda: 0.1,
  confirmedLambda: 0.6,
  rejectedLambda: 0.2,
  confirmDelta: 6,
  rejectDelta: 10,
} as const;

/**
 * ESPN abbreviations for 2026 first-year / new-school head coaches.
 * Sourced from the Football Scoop 2026 hiring-class debut list.
 * Unlisted clubs keep λ from year-over-year tape only.
 */
export const NCAAF_NEW_HEAD_COACHES_2026: readonly string[] = [
  "ARK", // Ryan Silverfield
  "AUB", // Alex Golesh
  "CAL", // Tosh Lupoi
  "CCU", // Ryan Beard
  "CONN", // Jason Candle
  "CSU", // Jim Mora
  "FLA", // Jon Sumrall
  "ISU", // Jimmy Rogers
  "JMU", // Billy Napier
  "KENT", // Mark Carney
  "KSU", // Collin Klein
  "LSU", // Lane Kiffin
  "MEM", // Charles Huff
  "MICH", // Kyle Whittingham
  "MISS", // Pete Golding
  "MOST", // Casey Woods
  "MSU", // Pat Fitzgerald
  "NIU", // Rob Harley
  "OHIO", // John Hauser
  "OKST", // Eric Morris
  "ORST", // JaMarcus Shepherd
  "PSU", // Matt Campbell
  "STAN", // Tavita Pritchard
  "TOL", // Mike Jacobs
  "TULN", // Will Hall
  "UAB", // Alex Mortensen
  "UCLA", // Bob Chesney
  "UK", // Will Stein
  "UNT", // Neal Brown
  "USF", // Brian Hartline
  "USM", // Blake Anderson
  "UTAH", // Morgan Scalley
  "VT", // James Franklin
  "WSU", // Kirby Moore
];

const NEW_HEAD_COACHES_BY_SEASON: Readonly<Record<number, ReadonlySet<string>>> = {
  2026: new Set(NCAAF_NEW_HEAD_COACHES_2026),
};

export type ContinuityReason =
  | "new-hc"
  | "confirmed"
  | "rejected"
  | "partial"
  | "prior-only"
  | "observed-only";

export type ContinuityDecision = {
  lambda: number;
  newHeadCoach: boolean;
  reason: ContinuityReason;
};

export type BlendLiveOptions = {
  newHeadCoachAbbreviations?: ReadonlySet<string>;
};

function assertLambda(value: number, name: string): number {
  const n = assertFiniteNumber(value, name);
  if (n < 0 || n > 1) {
    throw new Error(`${name} must be in [0, 1]`);
  }
  return n;
}

export function newHeadCoachSet(season: number, override?: ReadonlySet<string>): ReadonlySet<string> {
  if (override) {
    return override;
  }
  return NEW_HEAD_COACHES_BY_SEASON[season] ?? new Set();
}

export function isNewHeadCoach(
  abbreviation: string,
  season: number,
  override?: ReadonlySet<string>,
): boolean {
  if (typeof abbreviation !== "string" || abbreviation.length === 0) {
    throw new Error("abbreviation is required");
  }
  if (!Number.isInteger(season)) {
    throw new Error("season must be an integer");
  }
  return newHeadCoachSet(season, override).has(abbreviation);
}

export function continuityLambda(args: {
  newHeadCoach: boolean;
  priorNet: number;
  observedNet: number;
}): number {
  if (args.newHeadCoach) {
    return NCAAF_CONTINUITY.newHeadCoachLambda;
  }
  const priorNet = assertFiniteNumber(args.priorNet, "priorNet");
  const observedNet = assertFiniteNumber(args.observedNet, "observedNet");
  const delta = Math.abs(observedNet - priorNet);
  if (delta <= NCAAF_CONTINUITY.confirmDelta) {
    return NCAAF_CONTINUITY.confirmedLambda;
  }
  if (delta >= NCAAF_CONTINUITY.rejectDelta) {
    return NCAAF_CONTINUITY.rejectedLambda;
  }
  const span = NCAAF_CONTINUITY.rejectDelta - NCAAF_CONTINUITY.confirmDelta;
  const t = (delta - NCAAF_CONTINUITY.confirmDelta) / span;
  return (
    NCAAF_CONTINUITY.confirmedLambda +
    t * (NCAAF_CONTINUITY.rejectedLambda - NCAAF_CONTINUITY.confirmedLambda)
  );
}

export function continuityDecision(args: {
  abbreviation: string;
  season: number;
  priorNet?: number;
  observedNet?: number;
  newHeadCoachAbbreviations?: ReadonlySet<string>;
}): ContinuityDecision {
  const newHeadCoach = isNewHeadCoach(args.abbreviation, args.season, args.newHeadCoachAbbreviations);
  if (args.priorNet === undefined && args.observedNet === undefined) {
    throw new Error("priorNet or observedNet is required");
  }
  if (args.priorNet === undefined) {
    return { lambda: 0, newHeadCoach, reason: "observed-only" };
  }
  if (args.observedNet === undefined) {
    return { lambda: 1, newHeadCoach, reason: "prior-only" };
  }
  const lambda = assertLambda(
    continuityLambda({
      newHeadCoach,
      priorNet: args.priorNet,
      observedNet: args.observedNet,
    }),
    "lambda",
  );
  if (newHeadCoach) {
    return { lambda, newHeadCoach, reason: "new-hc" };
  }
  const delta = Math.abs(args.observedNet - args.priorNet);
  if (delta <= NCAAF_CONTINUITY.confirmDelta) {
    return { lambda, newHeadCoach, reason: "confirmed" };
  }
  if (delta >= NCAAF_CONTINUITY.rejectDelta) {
    return { lambda, newHeadCoach, reason: "rejected" };
  }
  return { lambda, newHeadCoach, reason: "partial" };
}

function mix(lambda: number, prior: number, observed: number): number {
  return lambda * prior + (1 - lambda) * observed;
}

function blendPair(prior: TeamRating, observed: TeamRating, lambda: number): TeamRating {
  const offense = mix(lambda, prior.offense, observed.offense);
  const defense = mix(lambda, prior.defense, observed.defense);
  return {
    team: observed.team,
    offense,
    defense,
    net: offense + defense,
    games: prior.games + observed.games,
    sos: observed.sos,
    avgPointsFor: observed.avgPointsFor,
    avgPointsAgainst: observed.avgPointsAgainst,
    residualMargin: observed.residualMargin,
    last4Residual: observed.last4Residual,
    homeResidual: observed.homeResidual,
    awayResidual: observed.awayResidual,
  };
}

export function blendLiveNcaafRatings(
  games: CompletedGame[],
  options?: BlendLiveOptions,
): TeamRating[] {
  if (!Array.isArray(games)) {
    throw new Error("games must be an array");
  }
  const ncaaf = games.filter(
    (game) => game.league === "ncaaf" && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore),
  );
  const seasons = [...new Set(ncaaf.map((game) => game.season))].sort((a, b) => a - b);
  const latestSeason = seasons[seasons.length - 1];
  if (latestSeason === undefined) {
    return [];
  }
  const priorGames = ncaaf.filter((game) => game.season === latestSeason - 1);
  const currentGames = ncaaf.filter((game) => game.season === latestSeason);
  const priorRatings = priorGames.length > 0 ? fitTeamRatings(priorGames, "ncaaf") : [];
  const currentRatings = currentGames.length > 0 ? fitTeamRatings(currentGames, "ncaaf") : [];
  const priorById = new Map(priorRatings.map((row) => [row.team.id, row]));
  const currentById = new Map(currentRatings.map((row) => [row.team.id, row]));
  const ids = new Set([...priorById.keys(), ...currentById.keys()]);
  const hcSet = newHeadCoachSet(latestSeason, options?.newHeadCoachAbbreviations);
  const blended: TeamRating[] = [];
  for (const id of ids) {
    const prior = priorById.get(id);
    const observed = currentById.get(id);
    if (prior && !observed) {
      blended.push(prior);
      continue;
    }
    if (observed && !prior) {
      blended.push(observed);
      continue;
    }
    if (!prior || !observed) {
      continue;
    }
    const decision = continuityDecision({
      abbreviation: observed.team.abbreviation,
      season: latestSeason,
      priorNet: prior.net,
      observedNet: observed.net,
      newHeadCoachAbbreviations: hcSet,
    });
    blended.push(blendPair(prior, observed, decision.lambda));
  }
  return blended.sort((a, b) => b.net - a.net);
}
