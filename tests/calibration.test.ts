import { describe, expect, it } from "vitest";
import { brierScore, reliabilityBins } from "@/src/lib/calibration";
import { backtestFlat } from "@/src/lib/backtest";

describe("calibration and backtest", () => {
  it("scores a perfect forecast with Brier 0", () => {
    expect(brierScore([1, 0, 1], [1, 0, 1])).toBe(0);
  });

  it("puts outcomes into reliability bins", () => {
    const bins = reliabilityBins([0.2, 0.2, 0.8, 0.8], [0, 1, 1, 1], 5);
    const low = bins.find((bin) => bin.n === 2 && bin.predicted < 0.4);
    const high = bins.find((bin) => bin.n === 2 && bin.predicted > 0.6);
    expect(low?.actual).toBeCloseTo(0.5, 8);
    expect(high?.actual).toBeCloseTo(1, 8);
  });

  it("grows the bankroll when calibrated bets beat S", () => {
    const summary = backtestFlat(
      [
        { p: 0.6, americanOdds: -110, won: true },
        { p: 0.6, americanOdds: -110, won: true },
        { p: 0.6, americanOdds: -110, won: false },
        { p: 0.6, americanOdds: -110, won: true },
      ],
      1,
    );
    expect(summary.n).toBe(4);
    expect(summary.units).toBeGreaterThan(0);
    expect(summary.empiricalP).toBeCloseTo(0.75, 8);
  });
});
