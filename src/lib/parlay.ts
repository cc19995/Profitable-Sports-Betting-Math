import { expectedValuePerBet, isPlusEv } from "./ev";
import { americanToImplied, assertFiniteNumber, assertProbability, devigTwoWay } from "./odds";
import { fractionalKelly } from "./kelly";
import type { ParlayEvaluation, ParlayLegInput } from "./types";

export function evaluateParlay(
  legs: ParlayLegInput[],
  oppositeOdds?: number[],
): ParlayEvaluation {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error("parlay requires at least one leg");
  }
  if (legs.length > 12) {
    throw new Error("parlay is capped at 12 legs");
  }

  let p = 1;
  let s = 1;
  let allPlusEv = true;
  const priced = legs.map((leg, index) => {
    const P_i = assertProbability(leg.p, `legs[${index}].p`);
    const s_i = americanToImplied(leg.americanOdds);
    if (typeof leg.label !== "string" || leg.label.trim().length === 0) {
      throw new Error(`legs[${index}].label is required`);
    }
    p *= P_i;
    s *= s_i;
    const opposite = oppositeOdds?.[index];
    const fairS = opposite !== undefined ? devigTwoWay(leg.americanOdds, opposite).homeFair : s_i;
    const juice = s_i - fairS;
    const edge = P_i - s_i;
    const plus = isPlusEv(P_i, s_i);
    if (!plus) {
      allPlusEv = false;
    }
    return {
      ...leg,
      s: s_i,
      fairS,
      juice,
      edge,
      plusEv: plus,
    };
  });

  const evPerUnit = expectedValuePerBet(p, s, 1);
  const compounds = allPlusEv && legs.length >= 2 && evPerUnit > expectedValuePerBet(priced[0]!.p, priced[0]!.s, 1);
  return {
    legs: priced,
    p,
    s,
    evPerUnit,
    plusEv: evPerUnit > 0,
    compounds,
    kellyQuarter: Math.max(0, fractionalKelly(p, s, 0.25)),
    warning: allPlusEv
      ? undefined
      : "At least one leg is not +EV. Adding -EV legs compounds juice against you.",
  };
}

export function parlayAmericanOdds(legOdds: number[]): number {
  if (legOdds.length === 0) {
    throw new Error("need at least one price");
  }
  let decimal = 1;
  for (const [index, odds] of legOdds.entries()) {
    assertFiniteNumber(odds, `odds[${index}]`);
    const s = americanToImplied(odds);
    decimal *= 1 / s;
  }
  if (decimal <= 1) {
    return -10000;
  }
  const profit = decimal - 1;
  if (profit >= 1) {
    return Math.round(profit * 100);
  }
  return Math.round(-100 / profit);
}
