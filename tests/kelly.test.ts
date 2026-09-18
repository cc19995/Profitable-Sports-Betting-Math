import { describe, expect, it } from "vitest";
import { fractionalKelly, kellyFraction, proportionalStake, recommendedStake } from "@/src/lib/kelly";

describe("kelly", () => {
  it("uses f* = (P - S) / (1 - S)", () => {
    expect(kellyFraction(0.55, 0.5)).toBeCloseTo(0.1, 8);
    expect(fractionalKelly(0.55, 0.5, 0.25)).toBeCloseTo(0.025, 8);
  });

  it("recommends zero stake when there is no edge", () => {
    expect(recommendedStake({ p: 0.5, americanOdds: -110, bankroll: 1000 })).toBe(0);
  });

  it("scales the proportional stake with P/S", () => {
    const low = proportionalStake({ p: 0.55, s: 0.52, baseStake: 10 });
    const high = proportionalStake({ p: 0.7, s: 0.52, baseStake: 10 });
    expect(high).toBeGreaterThan(low);
  });
});
