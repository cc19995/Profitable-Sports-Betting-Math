import { americanToImplied, assertFiniteNumber, assertProbability } from "./odds";

/**
 * Core +EV identity from this repository:
 *   Δ$ / N = B * (P / S - 1)
 * Profit requires P > S, where S is the sportsbook implied probability (juice on).
 */
export function expectedValuePerBet(p: number, s: number, stake = 1): number {
  const P = assertProbability(p, "P");
  const S = assertProbability(s, "S");
  const B = assertFiniteNumber(stake, "B");
  if (S === 0) {
    throw new Error("S cannot be 0");
  }
  if (B < 0) {
    throw new Error("B (stake) cannot be negative");
  }
  return B * (P / S - 1);
}

export function isPlusEv(p: number, s: number): boolean {
  return expectedValuePerBet(p, s, 1) > 0;
}

export function edgeVsImplied(p: number, s: number): number {
  return assertProbability(p, "P") - assertProbability(s, "S");
}

export function expectedValueFromOdds(p: number, americanOdds: number, stake = 1): number {
  return expectedValuePerBet(p, americanToImplied(americanOdds), stake);
}

export function realizedBankrollChange(args: {
  wins: number[];
  s: number;
  stake: number;
}): number {
  const S = assertProbability(args.s, "S");
  const B = assertFiniteNumber(args.stake, "stake");
  if (S === 0) {
    throw new Error("S cannot be 0");
  }
  if (args.wins.length === 0) {
    return 0;
  }
  let delta = 0;
  for (const [index, win] of args.wins.entries()) {
    if (win !== 0 && win !== 1) {
      throw new Error(`wins[${index}] must be 0 or 1`);
    }
    delta += (1 / S - 1) * B * win - B * (1 - win);
  }
  return delta;
}

export function averageGainPerBet(delta: number, n: number): number {
  const N = assertFiniteNumber(n, "N");
  if (N <= 0) {
    throw new Error("N must be positive");
  }
  return assertFiniteNumber(delta, "delta") / N;
}
