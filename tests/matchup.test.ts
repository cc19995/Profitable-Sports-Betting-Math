import { describe, expect, it } from "vitest";
import { handicapMatchup, isActionable } from "@/src/lib/matchup";
import { coverProbabilities, winProbabilities } from "@/src/lib/keyNumbers";
import type { TeamRating, UpcomingGame } from "@/src/lib/types";

function rating(abbr: string, offense: number, defense: number): TeamRating {
  return {
    team: { id: `nfl:${abbr}`, abbreviation: abbr, name: abbr },
    offense,
    defense,
    net: offense + defense,
    games: 16,
    sos: 0,
    avgPointsFor: 24,
    avgPointsAgainst: 20,
    residualMargin: 0,
    last4Residual: 0,
    homeResidual: 0,
    awayResidual: 0,
  };
}

describe("matchup pricing", () => {
  it("prices a home favorite as +EV only when P beats the juice", () => {
    const game: UpcomingGame = {
      id: "g1",
      league: "nfl",
      season: 2026,
      week: 1,
      gameType: "REG",
      kickoffIso: "2026-09-10T00:20:00Z",
      home: { id: "nfl:SEA", abbreviation: "SEA", name: "Seahawks" },
      away: { id: "nfl:NE", abbreviation: "NE", name: "Patriots" },
      neutralSite: false,
      market: {
        homeMoneyline: -185,
        awayMoneyline: 154,
        homeSpread: -3.5,
        homeSpreadOdds: -105,
        awaySpreadOdds: -115,
        total: 44.5,
        overOdds: -105,
        underOdds: -115,
      },
    };
    const report = handicapMatchup({
      game,
      ratings: [rating("SEA", 4, 3), rating("NE", 1, 0)],
    });
    expect(report.projection.margin).toBeGreaterThan(3);
    expect(report.priced.some((side) => side.betType === "moneyline")).toBe(true);
    const homeMl = report.priced.find((side) => side.side === "home" && side.betType === "moneyline");
    expect(homeMl).toBeTruthy();
    expect(homeMl!.plusEv).toBe(homeMl!.handicappedP > homeMl!.impliedS);
  });

  it("gives the home team a higher win probability when expected margin is positive", () => {
    const wins = winProbabilities({ expectedMargin: 7, sigma: 13.8 });
    expect(wins.home).toBeGreaterThan(0.65);
    expect(wins.home + wins.away).toBeCloseTo(1, 5);
    const covers = coverProbabilities({
      expectedMargin: 7,
      homeSpread: -3.5,
      sigma: 13.8,
      league: "nfl",
    });
    expect(covers.home).toBeGreaterThan(0.5);
  });

  it("does not treat huge-dog moneylines as actionable", () => {
    const side = {
      betType: "moneyline" as const,
      side: "away" as const,
      label: "KENT ML",
      americanOdds: 2500,
      handicappedP: 0.14,
      impliedS: 0.038,
      fairS: 0.03,
      juice: 0.008,
      edge: 0.102,
      evPerUnit: 2.6,
      kellyFull: 0.1,
      kellyQuarter: 0.025,
      plusEv: true,
    };
    expect(isActionable(side, { homeSpread: -35.5, total: 50 }, 19, 50, "ncaaf")).toBe(false);
    expect(isActionable({ ...side, betType: "spread", side: "away" }, { homeSpread: -3.5 }, 1, 45, "nfl")).toBe(true);
  });
});
