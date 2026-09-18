import { americanToImplied, assertFiniteNumber, assertProbability } from "./odds";

/**
 * Full Kelly fraction of bankroll.
 * f* = (P - S) / (1 - S)  for a even-money rewrite of decimal odds 1/S.
 * Equivalent to (p * d - 1) / (d - 1) with d = 1/S.
 */
export function kellyFraction(p: number, s: number): number {
  const P = assertProbability(p, "P");
  const S = assertProbability(s, "S");
  if (S <= 0 || S >= 1) {
    throw new Error("S must be in (0, 1) for Kelly");
  }
  return (P - S) / (1 - S);
}

export function fractionalKelly(p: number, s: number, fraction = 0.25): number {
  const f = assertFiniteNumber(fraction, "fraction");
  if (f <= 0 || f > 1) {
    throw new Error("Kelly fraction must be in (0, 1]");
  }
  return kellyFraction(p, s) * f;
}

export function recommendedStake(args: {
  p: number;
  americanOdds: number;
  bankroll: number;
  fraction?: number;
}): number {
  const bankroll = assertFiniteNumber(args.bankroll, "bankroll");
  if (bankroll <= 0) {
    throw new Error("bankroll must be positive");
  }
  const s = americanToImplied(args.americanOdds);
  const f = fractionalKelly(args.p, s, args.fraction ?? 0.25);
  if (f <= 0) {
    return 0;
  }
  return bankroll * f;
}

/** B ∝ P / S as written in the dynamic-staking derivation. */
export function proportionalStake(args: {
  p: number;
  s: number;
  baseStake: number;
  baseRatio?: number;
}): number {
  const P = assertProbability(args.p, "P");
  const S = assertProbability(args.s, "S");
  const B0 = assertFiniteNumber(args.baseStake, "baseStake");
  const ratio0 = args.baseRatio ?? 1;
  if (S === 0) {
    throw new Error("S cannot be 0");
  }
  if (B0 < 0) {
    throw new Error("baseStake cannot be negative");
  }
  return B0 * (P / S) / ratio0;
}
