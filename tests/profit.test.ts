import { describe, expect, it } from "vitest";
import { isLiveLeague, isProfitEligible, PROFIT_GATE } from "@/src/lib/profit";
import { expectedValuePerBet } from "@/src/lib/ev";
import type { PricedSide } from "@/src/lib/types";

function side(partial: Partial<PricedSide> & Pick<PricedSide, "betType" | "side" | "label">): PricedSide {
  const handicappedP = partial.handicappedP ?? 0.58;
  const impliedS = partial.impliedS ?? 0.5238;
  return {
    americanOdds: -110,
    handicappedP,
    impliedS,
    fairS: 0.5,
    juice: 0.0238,
    edge: handicappedP - impliedS,
    evPerUnit: expectedValuePerBet(handicappedP, impliedS),
    kellyFull: 0.1,
    kellyQuarter: 0.025,
    plusEv: true,
    ...partial,
  };
}

describe("profit gate", () => {
  it("rejects moneylines even when they clear the trust filter", () => {
    const ml = side({
      betType: "moneyline",
      side: "home",
      label: "HOM ML",
      handicappedP: 0.6,
      impliedS: 0.55,
    });
    expect(
      isProfitEligible(ml, { homeSpread: -3, total: 44.5 }, 6, 47, "nfl", { confidence: 70, homeGames: 10, awayGames: 10 }, 1),
    ).toBe(false);
  });

  it("keeps an aligned NCAAF spread with a real but not flashy edge", () => {
    const spread = side({ betType: "spread", side: "home", label: "HOM -3" });
    expect(spread.edge).toBeGreaterThan(PROFIT_GATE.minEdge);
    expect(
      isProfitEligible(
        spread,
        { homeSpread: -3, total: 44.5 },
        6,
        47,
        "ncaaf",
        { confidence: 70, homeGames: 10, awayGames: 10 },
        1,
      ),
    ).toBe(true);
  });

  it("still measures NFL in walk-forward even though the live desk sits it", () => {
    const spread = side({ betType: "spread", side: "home", label: "HOM -3" });
    expect(isLiveLeague("nfl")).toBe(false);
    expect(isLiveLeague("ncaaf")).toBe(true);
    expect(
      isProfitEligible(
        spread,
        { homeSpread: -3, total: 44.5 },
        6,
        47,
        "nfl",
        { confidence: 70, homeGames: 10, awayGames: 10 },
        1,
      ),
    ).toBe(true);
  });

  it("rejects a side that is far from the market", () => {
    const spread = side({ betType: "spread", side: "home", label: "HOM -3", handicappedP: 0.6 });
    expect(
      isProfitEligible(
        spread,
        { homeSpread: -3, total: 44.5 },
        6,
        47,
        "ncaaf",
        { confidence: 70, homeGames: 10, awayGames: 10 },
        0.12,
      ),
    ).toBe(false);
  });
});
