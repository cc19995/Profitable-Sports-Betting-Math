import type { League } from "../types";
import { HOUSE_FACTORS, type HouseModel, type HouseWeights } from "./types";

/**
 * Rithmm Core house factors: Running, Passing, Offense, Defense, Ranks.
 * Weights are principle-driven defaults, not fit to last weekend.
 * NFL is pass-heavy; CFB keeps more run / rank (talent gap) mass.
 */
export const HOUSE_MODELS: Record<League, HouseModel> = {
  nfl: {
    name: "House",
    league: "nfl",
    weights: {
      passing: 0.32,
      running: 0.14,
      offense: 0.18,
      defense: 0.26,
      ranks: 0.1,
    },
    pointsPerSigma: 4.8,
    description: "NFL house model on nflverse EPA: pass, rush, offense, defense, net rank.",
  },
  ncaaf: {
    name: "House",
    league: "ncaaf",
    weights: {
      passing: 0.24,
      running: 0.2,
      offense: 0.18,
      defense: 0.22,
      ranks: 0.16,
    },
    pointsPerSigma: 6.4,
    description: "NCAAF house model on sportsdataverse EPA/success/tempo and opponent-adjusted ranks.",
  },
};

export function getHouseModel(league: League): HouseModel {
  const model = HOUSE_MODELS[league];
  if (!model) {
    throw new Error(`unsupported league: ${String(league)}`);
  }
  return model;
}

export function normalizeWeights(weights: HouseWeights): HouseWeights {
  let sum = 0;
  for (const key of HOUSE_FACTORS) {
    const value = weights[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`house weight ${key} must be a finite non-negative number`);
    }
    sum += value;
  }
  if (sum <= 0) {
    throw new Error("house weights must sum to a positive number");
  }
  return {
    running: weights.running / sum,
    passing: weights.passing / sum,
    offense: weights.offense / sum,
    defense: weights.defense / sum,
    ranks: weights.ranks / sum,
  };
}
