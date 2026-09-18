import { describe, expect, it } from "vitest";
import { averageGainPerBet, expectedValuePerBet, isPlusEv, realizedBankrollChange } from "@/src/lib/ev";
import { americanToImplied } from "@/src/lib/odds";

describe("plus-EV identity", () => {
  it("matches Δ$/N = B (P/S - 1)", () => {
    const P = 0.7;
    const S = americanToImplied(-200);
    const B = 10;
    expect(S).toBeCloseTo(2 / 3, 8);
    expect(expectedValuePerBet(P, S, B)).toBeCloseTo(B * (P / S - 1), 8);
    expect(isPlusEv(P, S)).toBe(true);
  });

  it("is profitable if and only if P > S", () => {
    expect(isPlusEv(0.53, americanToImplied(-110))).toBe(true);
    expect(isPlusEv(0.52, americanToImplied(-110))).toBe(false);
    expect(expectedValuePerBet(0.52381, americanToImplied(-110), 1)).toBeCloseTo(0, 3);
  });

  it("reconstructs bankroll change from binarized wins", () => {
    const S = 0.5;
    const wins = [1, 0, 1, 1, 0];
    const delta = realizedBankrollChange({ wins, s: S, stake: 2 });
    expect(delta).toBe(2);
    expect(averageGainPerBet(delta, wins.length)).toBeCloseTo(0.4, 8);
  });
});
