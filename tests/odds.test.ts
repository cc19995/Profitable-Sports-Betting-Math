import { describe, expect, it } from "vitest";
import {
  americanToDecimal,
  americanToImplied,
  devigTwoWay,
  impliedToAmerican,
  parseAmericanOdds,
  returnOnRisk,
} from "@/src/lib/odds";

describe("odds", () => {
  it("converts standard American prices to implied S", () => {
    expect(americanToImplied(-110)).toBeCloseTo(0.52381, 4);
    expect(americanToImplied(100)).toBeCloseTo(0.5, 6);
    expect(americanToImplied(150)).toBeCloseTo(0.4, 6);
    expect(americanToImplied(-200)).toBeCloseTo(2 / 3, 6);
  });

  it("decimal odds equal 1/S", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1 / americanToImplied(-110), 8);
    expect(americanToDecimal(200)).toBeCloseTo(3, 8);
    expect(returnOnRisk(-110)).toBeCloseTo(100 / 110, 6);
  });

  it("round-trips implied probabilities through American odds", () => {
    expect(americanToImplied(impliedToAmerican(0.75))).toBeCloseTo(0.75, 2);
    expect(americanToImplied(impliedToAmerican(0.4))).toBeCloseTo(0.4, 2);
  });

  it("de-vigs a -110 / -110 market to a fair coin", () => {
    const market = devigTwoWay(-110, -110);
    expect(market.homeFair).toBeCloseTo(0.5, 8);
    expect(market.awayFair).toBeCloseTo(0.5, 8);
    expect(market.overround).toBeCloseTo(1.04762, 4);
    expect(market.homeJuice).toBeGreaterThan(0);
  });

  it("rejects invalid American odds", () => {
    expect(() => parseAmericanOdds(0)).toThrow(/cannot be 0/);
    expect(() => parseAmericanOdds(50)).toThrow(/plus-odds/);
    expect(() => parseAmericanOdds(-50)).toThrow(/minus-odds/);
  });
});
