import { isTrustEligible, type TrustExtras } from "./matchup";
import type { League, MarketLines, PricedSide } from "./types";

/**
 * Profit gates on top of the trust filter.
 * Locked from failure modes we already know, not from Saturday's losers:
 * the Gaussian overstates P, moneylines are the worst of that, and huge
 * projection-vs-market gaps are model error rather than a 20-point edge.
 */
export const PROFIT_GATE = {
  allowMoneyline: false,
  minAlignment: 0.8,
  minEdge: 0.04,
  maxEvPerUnit: 0.45,
  allowedLeagues: ["ncaaf"] as const,
} as const;

export function isLiveLeague(league: League): boolean {
  return (PROFIT_GATE.allowedLeagues as readonly string[]).includes(league);
}

export function isProfitEligible(
  side: PricedSide,
  market: MarketLines | undefined,
  modelMargin: number,
  modelTotal: number,
  league: League,
  extras: TrustExtras | undefined,
  alignment: number,
): boolean {
  if (!isTrustEligible(side, market, modelMargin, modelTotal, league, extras)) {
    return false;
  }
  if (!PROFIT_GATE.allowMoneyline && side.betType === "moneyline") {
    return false;
  }
  if (side.edge < PROFIT_GATE.minEdge) {
    return false;
  }
  if (side.evPerUnit > PROFIT_GATE.maxEvPerUnit) {
    return false;
  }
  if (alignment < PROFIT_GATE.minAlignment) {
    return false;
  }
  return true;
}
