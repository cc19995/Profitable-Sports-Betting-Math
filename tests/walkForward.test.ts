import { describe, expect, it } from "vitest";
import { marketFromEspnCoreOdds } from "@/src/data/espnOdds";
import { gradeCompletedSide, inferHoldoutSeason, walkForwardBets } from "@/src/lib/walkForward";
import type { CompletedGame, PricedSide, TeamRef } from "@/src/lib/types";

function team(abbr: string): TeamRef {
  return { id: `ncaaf:${abbr}`, abbreviation: abbr, name: abbr };
}

function priced(partial: Partial<PricedSide> & Pick<PricedSide, "betType" | "side" | "label">): PricedSide {
  return {
    americanOdds: -110,
    handicappedP: 0.6,
    impliedS: 0.5238,
    fairS: 0.5,
    juice: 0.0238,
    edge: 0.0762,
    evPerUnit: 0.145,
    kellyFull: 0.16,
    kellyQuarter: 0.04,
    plusEv: true,
    ...partial,
  };
}

function game(args: {
  id: string;
  season: number;
  week: number;
  home: string;
  away: string;
  hs: number;
  as: number;
  homeSpread?: number;
  total?: number;
}): CompletedGame {
  return {
    id: args.id,
    league: "ncaaf",
    season: args.season,
    week: args.week,
    gameType: "REG",
    kickoffIso: `${args.season}-09-${String(Math.min(args.week + 1, 28)).padStart(2, "0")}T17:00:00Z`,
    home: team(args.home),
    away: team(args.away),
    homeScore: args.hs,
    awayScore: args.as,
    neutralSite: false,
    market:
      args.homeSpread !== undefined || args.total !== undefined
        ? {
            book: "ESPN BET",
            homeSpread: args.homeSpread,
            homeSpreadOdds: -110,
            awaySpreadOdds: -110,
            total: args.total,
            overOdds: -110,
            underOdds: -110,
            homeMoneyline: -150,
            awayMoneyline: 130,
          }
        : undefined,
  };
}

describe("gradeCompletedSide", () => {
  const base = game({
    id: "g",
    season: 2025,
    week: 1,
    home: "HOM",
    away: "AWY",
    hs: 27,
    as: 24,
    homeSpread: -3,
    total: 52.5,
  });

  it("pushes a spread that lands on the number", () => {
    expect(gradeCompletedSide(priced({ betType: "spread", side: "home", label: "HOM -3" }), base)).toBe("P");
  });

  it("wins an under when the game stays below the total", () => {
    expect(gradeCompletedSide(priced({ betType: "total", side: "under", label: "Under 51" }), base)).toBe("W");
  });

  it("wins the home moneyline when the home team wins", () => {
    expect(gradeCompletedSide(priced({ betType: "moneyline", side: "home", label: "HOM ML" }), base)).toBe("W");
  });
});

describe("walk-forward holdout", () => {
  it("uses the previous season when the latest year is still short", () => {
    const games = [
      game({ id: "a", season: 2024, week: 1, home: "A", away: "B", hs: 20, as: 10 }),
      ...Array.from({ length: 70 }, (_, i) =>
        game({ id: `p${i}`, season: 2025, week: 1, home: "A", away: "B", hs: 21, as: 17 }),
      ),
      game({ id: "now", season: 2026, week: 1, home: "A", away: "B", hs: 14, as: 7 }),
    ];
    expect(inferHoldoutSeason(games)).toBe(2025);
  });

  it("only prices the holdout season and skips games without a market", () => {
    const prior = Array.from({ length: 40 }, (_, i) => {
      const home = i % 2 === 0 ? "STR" : "WK";
      const away = home === "STR" ? "WK" : "STR";
      return game({
        id: `2024-${i}`,
        season: 2024,
        week: (i % 12) + 1,
        home,
        away,
        hs: home === "STR" ? 35 : 10,
        as: home === "STR" ? 10 : 31,
      });
    });
    const holdout = [
      game({
        id: "ncaaf:1",
        season: 2025,
        week: 1,
        home: "STR",
        away: "WK",
        hs: 31,
        as: 10,
        homeSpread: -3,
        total: 48.5,
      }),
      game({
        id: "ncaaf:2",
        season: 2025,
        week: 1,
        home: "WK",
        away: "STR",
        hs: 7,
        as: 28,
      }),
    ];
    const bets = walkForwardBets([...prior, ...holdout], "ncaaf", {
      holdoutSeason: 2025,
      minHistory: 20,
      minTeamGames: 3,
      pick: "trusted",
    });
    expect(bets.length).toBeGreaterThan(0);
    expect(bets.every((bet) => bet.p > 0 && bet.p < 1)).toBe(true);
  });

  it("returns no bets when the holdout year has no closing lines", () => {
    const prior = Array.from({ length: 40 }, (_, i) =>
      game({
        id: `p${i}`,
        season: 2024,
        week: 1,
        home: "STR",
        away: "WK",
        hs: 30,
        as: 10,
      }),
    );
    const holdout = [
      game({ id: "h1", season: 2025, week: 1, home: "STR", away: "WK", hs: 24, as: 17 }),
    ];
    expect(
      walkForwardBets([...prior, ...holdout], "ncaaf", {
        holdoutSeason: 2025,
        minHistory: 10,
        minTeamGames: 1,
      }),
    ).toEqual([]);
  });
});

describe("ESPN core odds mapping", () => {
  it("reads close spread, total, and moneylines", () => {
    const market = marketFromEspnCoreOdds({
      items: [
        {
          provider: { name: "ESPN BET" },
          spread: 1.5,
          overUnder: 53.5,
          overOdds: -110,
          underOdds: -110,
          homeTeamOdds: {
            moneyLine: 105,
            spreadOdds: -120,
            close: {
              pointSpread: { american: "+1.5" },
              spread: { american: "-120" },
              moneyLine: { american: "+105" },
            },
          },
          awayTeamOdds: {
            moneyLine: -125,
            spreadOdds: 100,
            close: {
              pointSpread: { american: "-1.5" },
              spread: { american: "+100" },
              moneyLine: { american: "-125" },
            },
          },
        },
      ],
    });
    expect(market?.book).toBe("ESPN BET");
    expect(market?.homeSpread).toBe(1.5);
    expect(market?.total).toBe(53.5);
    expect(market?.homeMoneyline).toBe(105);
    expect(market?.awayMoneyline).toBe(-125);
    expect(market?.homeSpreadOdds).toBe(-120);
  });
});
