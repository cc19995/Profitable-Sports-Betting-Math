import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_CAPS,
  AVAILABILITY_SCALE,
  buildAvailabilityOverlay,
  decideAvailabilityPick,
  estimateItemPoints,
  parseAvailabilityItem,
  subtractAgreeingMove,
  type AvailabilityItem,
} from "@/src/lib/availability";
import { priceNcaafGameWithAvailability } from "@/src/lib/availabilityDesk";
import { PROFIT_GATE } from "@/src/lib/profit";
import type { PricedSide, TeamRating, UpcomingGame } from "@/src/lib/types";

function item(partial: Partial<AvailabilityItem> & Pick<AvailabilityItem, "player" | "side" | "positionGroup">): AvailabilityItem {
  return {
    teamAbbreviation: partial.teamAbbreviation ?? (partial.side === "home" ? "HOM" : "AWY"),
    status: partial.status ?? "out",
    sources: partial.sources ?? ["official-release"],
    starter: partial.starter ?? true,
    replacementQuality: partial.replacementQuality,
    snapsLast2: partial.snapsLast2,
    ...partial,
  };
}

function rating(abbr: string, offense: number, defense: number): TeamRating {
  return {
    team: { id: `ncaaf:${abbr}`, abbreviation: abbr, name: abbr },
    offense,
    defense,
    net: offense + defense,
    games: 8,
    sos: 0,
    avgPointsFor: 28,
    avgPointsAgainst: 24,
    residualMargin: 0,
    last4Residual: 0,
    homeResidual: 0,
    awayResidual: 0,
  };
}

describe("estimateItemPoints", () => {
  it("uses the published QB / WR / edge / OL scale", () => {
    expect(estimateItemPoints(item({ player: "A", side: "away", positionGroup: "qb", replacementQuality: "poor" })).points)
      .toBe(AVAILABILITY_SCALE.qb.poor);
    expect(estimateItemPoints(item({ player: "B", side: "away", positionGroup: "wr", replacementQuality: "capable" })).points)
      .toBe(AVAILABILITY_SCALE.wr.capable);
    expect(estimateItemPoints(item({ player: "C", side: "home", positionGroup: "edge", replacementQuality: "average" })).points)
      .toBe(AVAILABILITY_SCALE.edge.average);
    expect(estimateItemPoints(item({ player: "D", side: "home", positionGroup: "ol", replacementQuality: "poor" })).points)
      .toBe(AVAILABILITY_SCALE.ol.poor);
  });

  it("prices doubtful at half of out and does not auto-price questionable", () => {
    const out = estimateItemPoints(item({ player: "A", side: "away", positionGroup: "wr", status: "out", replacementQuality: "average" }));
    const doubtful = estimateItemPoints(item({ player: "A", side: "away", positionGroup: "wr", status: "doubtful", replacementQuality: "average" }));
    const questionable = estimateItemPoints(item({ player: "A", side: "away", positionGroup: "wr", status: "questionable", replacementQuality: "average" }));
    expect(out.points).toBe(AVAILABILITY_SCALE.wr.average);
    expect(doubtful.points).toBeCloseTo(AVAILABILITY_SCALE.wr.average * 0.5, 1);
    expect(questionable.points).toBe(0);
    expect(questionable.skipReason).toBe("status-unpriced");
  });

  it("skips zero-snap players as already in the tape", () => {
    const skipped = estimateItemPoints(item({
      player: "Chapman",
      side: "away",
      positionGroup: "wr",
      starter: true,
      snapsLast2: 0,
    }));
    expect(skipped.points).toBe(0);
    expect(skipped.skipReason).toBe("already-in-tape");
  });

  it("requires usage or an explicit starter flag", () => {
    const noUsage = estimateItemPoints(item({
      player: "Backup",
      side: "home",
      positionGroup: "qb",
      starter: false,
    }));
    expect(noUsage.points).toBe(0);
    expect(noUsage.skipReason).toBe("insufficient-usage");
  });

  it("requires a typed source", () => {
    const none = estimateItemPoints(item({
      player: "A",
      side: "home",
      positionGroup: "ol",
      sources: [],
    }));
    expect(none.skipReason).toBe("missing-source");
  });
});

describe("buildAvailabilityOverlay", () => {
  it("writes QB points into qb* and everyone else into user*", () => {
    const overlay = buildAvailabilityOverlay({
      items: [
        item({ player: "QB", side: "away", positionGroup: "qb", replacementQuality: "capable" }),
        item({ player: "WR", side: "away", positionGroup: "wr", replacementQuality: "capable" }),
      ],
    });
    expect(overlay.qbAway).toBe(AVAILABILITY_SCALE.qb.capable);
    expect(overlay.userAway).toBe(AVAILABILITY_SCALE.wr.capable);
    expect(overlay.qbHome).toBe(0);
    expect(overlay.userHome).toBe(0);
    expect(overlay.applied).toBe(true);
  });

  it("caps stacked non-QB overlay at 3 points", () => {
    const overlay = buildAvailabilityOverlay({
      items: [
        item({ player: "WR1", side: "away", positionGroup: "wr", replacementQuality: "poor" }),
        item({ player: "EDGE", side: "away", positionGroup: "edge", replacementQuality: "poor" }),
        item({ player: "LT", side: "away", positionGroup: "ol", replacementQuality: "poor" }),
      ],
    });
    expect(overlay.userAway).toBeCloseTo(-AVAILABILITY_CAPS.defaultAbs, 5);
    expect(Math.abs(overlay.userAway)).toBeLessThan(
      Math.abs(AVAILABILITY_SCALE.wr.poor + AVAILABILITY_SCALE.edge.poor + AVAILABILITY_SCALE.ol.poor),
    );
  });

  it("lifts the cap when a starting QB is out", () => {
    const overlay = buildAvailabilityOverlay({
      items: [
        item({ player: "QB", side: "home", positionGroup: "qb", replacementQuality: "poor" }),
      ],
    });
    expect(overlay.startingQbOutHome).toBe(true);
    expect(overlay.qbHome).toBe(AVAILABILITY_SCALE.qb.poor);
    expect(Math.abs(overlay.qbHome)).toBeGreaterThan(AVAILABILITY_CAPS.defaultAbs);
    expect(Math.abs(overlay.qbHome)).toBeLessThanOrEqual(AVAILABILITY_CAPS.startingQbOutAbs);
  });

  it("subtracts an agreeing open-to-current move and does not amplify a disagreement", () => {
    const items = [item({ player: "WR", side: "away", positionGroup: "wr", replacementQuality: "poor" })];
    const raw = buildAvailabilityOverlay({ items });
    expect(raw.userAway).toBe(AVAILABILITY_SCALE.wr.poor);

    const agreeing = buildAvailabilityOverlay({
      items,
      market: { homeSpread: -4.5, openHomeSpread: -3, total: 49.5, openTotal: 52.5 },
    });
    expect(Math.abs(agreeing.userAway)).toBeLessThan(Math.abs(raw.userAway));

    const disagree = buildAvailabilityOverlay({
      items,
      market: { homeSpread: -1.5, openHomeSpread: -3, total: 54.5, openTotal: 52.5 },
    });
    expect(disagree.userAway).toBe(raw.userAway);
  });

  it("zeros the overlay when the market already fully priced the injury", () => {
    const overlay = buildAvailabilityOverlay({
      items: [item({ player: "WR", side: "home", positionGroup: "wr", replacementQuality: "capable" })],
      market: { homeSpread: 2, openHomeSpread: 0, total: 48.5, openTotal: 50.5 },
    });
    expect(overlay.userHome).toBe(0);
    expect(overlay.applied).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(() => buildAvailabilityOverlay({ items: "nope" as unknown as AvailabilityItem[] })).toThrow(
      /must be an array/,
    );
  });
});

describe("subtractAgreeingMove", () => {
  it("does not add when the market moved the other way", () => {
    expect(subtractAgreeingMove(-2, 1)).toBe(-2);
    expect(subtractAgreeingMove(-2, -1.5)).toBeCloseTo(-0.5, 5);
    expect(subtractAgreeingMove(-2, -3)).toBe(0);
  });
});

describe("parseAvailabilityItem", () => {
  it("validates typed fields", () => {
    expect(() => parseAvailabilityItem({ player: "", side: "home", positionGroup: "qb", status: "out", sources: ["beat-writer"] }))
      .toThrow(/player/);
    expect(() => parseAvailabilityItem({
      player: "A",
      teamAbbreviation: "UNC",
      side: "home",
      positionGroup: "rb",
      status: "out",
      sources: ["beat-writer"],
    })).toThrow(/positionGroup/);
  });
});

describe("decideAvailabilityPick", () => {
  const homeSpread: PricedSide = {
    betType: "spread",
    side: "home",
    label: "HOM -3",
    americanOdds: -110,
    handicappedP: 0.57,
    impliedS: 0.5238,
    fairS: 0.5,
    juice: 0.0238,
    edge: 0.0462,
    evPerUnit: 0.09,
    kellyFull: 0.1,
    kellyQuarter: 0.025,
    plusEv: true,
  };
  const awaySpread: PricedSide = { ...homeSpread, side: "away", label: "AWY +3" };

  it("sits a same-market side flip", () => {
    const decided = decideAvailabilityPick({ basePick: awaySpread, overlayPick: homeSpread });
    expect(decided.action).toBe("sit-flip");
    expect(decided.pick).toBeNull();
  });

  it("cuts when the original pick dies and does not invent the other side", () => {
    const decided = decideAvailabilityPick({ basePick: awaySpread, overlayPick: null });
    expect(decided.action).toBe("cut");
    expect(decided.pick).toBeNull();
  });

  it("keeps the same side", () => {
    const decided = decideAvailabilityPick({ basePick: awaySpread, overlayPick: awaySpread });
    expect(decided.action).toBe("keep");
    expect(decided.pick).toBe(awaySpread);
  });
});

describe("priceNcaafGameWithAvailability", () => {
  it("re-prices through qb/user and sits a flipped spread", () => {
    const game: UpcomingGame = {
      id: "ncaaf:1",
      league: "ncaaf",
      season: 2026,
      week: 3,
      gameType: "REG",
      kickoffIso: "2026-09-19T16:00:00Z",
      home: { id: "ncaaf:HOM", abbreviation: "HOM", name: "Home" },
      away: { id: "ncaaf:AWY", abbreviation: "AWY", name: "Away" },
      neutralSite: false,
      market: {
        homeSpread: 0,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        total: 80,
        overOdds: -110,
        underOdds: -110,
      },
    };
    const ratings = [rating("HOM", 0, 0), rating("AWY", 6, 0)];
    const base = priceNcaafGameWithAvailability({ game, ratings, items: [], priceWithHouse: false });
    expect(base.bestBet?.betType).toBe("spread");
    expect(base.bestBet?.side).toBe("away");

    const flipped = priceNcaafGameWithAvailability({
      game,
      ratings,
      priceWithHouse: false,
      items: [item({ player: "Starter QB", side: "away", positionGroup: "qb", replacementQuality: "poor" })],
    });
    expect(flipped.report.adjustments.qbAway).toBe(AVAILABILITY_SCALE.qb.poor);
    expect(flipped.report.projection.margin).toBeGreaterThan(base.report.projection.margin);
    expect(flipped.bestBet).toBeNull();
    expect(flipped.report.signals.some((signal) => signal.id === "agent-a-sit-flip")).toBe(true);
  });
});

describe("profit gate untouched", () => {
  it("does not change the locked constants", () => {
    expect(PROFIT_GATE).toEqual({
      allowMoneyline: false,
      minAlignment: 0.8,
      minEdge: 0.04,
      maxEvPerUnit: 0.45,
      allowedLeagues: ["ncaaf"],
    });
  });
});
