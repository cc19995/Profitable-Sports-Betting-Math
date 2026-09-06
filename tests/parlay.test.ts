import { describe, expect, it } from "vitest";
import { evaluateParlay } from "@/src/lib/parlay";
import { expectedValuePerBet } from "@/src/lib/ev";
import { americanToImplied } from "@/src/lib/odds";

describe("parlay compounding", () => {
  it("compounds +EV when every leg beats juice", () => {
    const legs = [
      { label: "A", p: 0.58, americanOdds: -110 },
      { label: "B", p: 0.58, americanOdds: -110 },
    ];
    const result = evaluateParlay(legs);
    const p = 0.58 * 0.58;
    const s = americanToImplied(-110) ** 2;
    expect(result.p).toBeCloseTo(p, 8);
    expect(result.s).toBeCloseTo(s, 8);
    expect(result.evPerUnit).toBeCloseTo(expectedValuePerBet(p, s, 1), 8);
    expect(result.plusEv).toBe(true);
    expect(result.evPerUnit).toBeGreaterThan(expectedValuePerBet(0.58, americanToImplied(-110), 1));
  });

  it("destroys EV when a no-edge fair-coin leg is added", () => {
    const single = evaluateParlay([{ label: "A", p: 0.58, americanOdds: -110 }]);
    const withJuiceLeg = evaluateParlay([
      { label: "A", p: 0.58, americanOdds: -110 },
      { label: "B", p: 0.5, americanOdds: -110 },
    ]);
    expect(withJuiceLeg.evPerUnit).toBeLessThan(single.evPerUnit);
    expect(withJuiceLeg.warning).toMatch(/not \+EV/);
  });
});
