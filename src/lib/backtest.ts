import { averageGainPerBet, expectedValuePerBet, realizedBankrollChange } from "./ev";
import { brierScore, reliabilityBins } from "./calibration";
import { americanToImplied, assertFiniteNumber } from "./odds";
import type { BacktestSummary } from "./types";

export interface HistoricalBet {
  p: number;
  americanOdds: number;
  won: boolean;
}

export function backtestFlat(bets: HistoricalBet[], stake = 1): BacktestSummary {
  if (!Array.isArray(bets) || bets.length === 0) {
    throw new Error("backtest requires at least one bet");
  }
  const B = assertFiniteNumber(stake, "stake");
  if (B <= 0) {
    throw new Error("stake must be positive");
  }

  const predictions: number[] = [];
  const outcomes: number[] = [];
  const wins: number[] = [];
  let units = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let sSum = 0;

  for (const [index, bet] of bets.entries()) {
    const s = americanToImplied(bet.americanOdds);
    const win = bet.won ? 1 : 0;
    const delta = realizedBankrollChange({ wins: [win], s, stake: B });
    units += delta;
    peak = Math.max(peak, units);
    maxDrawdown = Math.max(maxDrawdown, peak - units);
    predictions.push(bet.p);
    outcomes.push(win);
    wins.push(win);
    sSum += s;
    void index;
  }

  const n = bets.length;
  const winCount = wins.reduce<number>((sum, w) => sum + w, 0);
  return {
    n,
    wins: winCount,
    empiricalP: winCount / n,
    avgS: sSum / n,
    units,
    roi: averageGainPerBet(units, n) / B,
    maxDrawdown,
    brier: brierScore(predictions, outcomes),
    bins: reliabilityBins(predictions, outcomes, 10),
  };
}

export function expectedUnitsIfCalibrated(bets: HistoricalBet[], stake = 1): number {
  return bets.reduce((sum, bet) => {
    const s = americanToImplied(bet.americanOdds);
    return sum + expectedValuePerBet(bet.p, s, stake);
  }, 0);
}
