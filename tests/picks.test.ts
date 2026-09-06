import { describe, expect, it } from "vitest";
import { expectedValuePerBet } from "../src/lib/ev";
import {
  bestBetsFromPicks,
  buildParlayCombos,
  collectEligiblePicks,
  isBestBetEligible,
  pickQuality,
  selectTrustedBestBet,
} from "../src/lib/picks";
import type { BoardRow, MarketLines, PricedSide, ScoreProjection, TeamRating } from "../src/lib/types";

function rating(abbr: string, games = 8): TeamRating {
  return {
    team: { id: `nfl:${abbr}`, abbreviation: abbr, name: abbr },
    offense: 2,
    defense: 1,
    net: 3,
    games,
    sos: 0,
    avgPointsFor: 24,
    avgPointsAgainst: 20,
    residualMargin: 0,
    last4Residual: 0,
    homeResidual: 0,
    awayResidual: 0,
  };
}

function projection(margin: number, total: number): ScoreProjection {
  return {
    homeScore: 22 + margin / 2,
    awayScore: 22 - margin / 2,
    margin,
    total,
    winProbHome: 0.6,
    winProbAway: 0.4,
    coverProbHome: 0.55,
    coverProbAway: 0.45,
    pushProbSpread: 0,
    overProb: 0.5,
    underProb: 0.5,
    pushProbTotal: 0,
  };
}

function priced(partial: Partial<PricedSide> & Pick<PricedSide, "label" | "betType">): PricedSide {
  const handicappedP = partial.handicappedP ?? 0.58;
  const impliedS = partial.impliedS ?? 0.5238;
  const evPerUnit = partial.evPerUnit ?? expectedValuePerBet(handicappedP, impliedS);
  return {
    betType: partial.betType,
    side: partial.side ?? "home",
    label: partial.label,
    americanOdds: partial.americanOdds ?? -110,
    handicappedP,
    impliedS,
    fairS: partial.fairS ?? 0.5,
    juice: partial.juice ?? 0.0238,
    edge: partial.edge ?? handicappedP - impliedS,
    evPerUnit,
    kellyFull: partial.kellyFull ?? 0.1,
    kellyQuarter: partial.kellyQuarter ?? 0.025,
    plusEv: partial.plusEv ?? evPerUnit > 0,
  };
}

function row(overrides: {
  id?: string;
  league?: BoardRow["game"]["league"];
  kickoffIso?: string;
  home?: string;
  away?: string;
  market?: MarketLines;
  margin?: number;
  total?: number;
  confidence?: number;
  homeGames?: number;
  awayGames?: number;
  priced: PricedSide[];
}): BoardRow {
  const home = overrides.home ?? "HOM";
  const away = overrides.away ?? "AWY";
  return {
    game: {
      id: overrides.id ?? "g1",
      league: overrides.league ?? "nfl",
      season: 2026,
      week: 1,
      gameType: "REG",
      kickoffIso: overrides.kickoffIso ?? "2026-09-07T17:00:00.000Z",
      home: { id: `nfl:${home}`, abbreviation: home, name: home },
      away: { id: `nfl:${away}`, abbreviation: away, name: away },
      neutralSite: false,
      market: overrides.market ?? {
        homeSpread: -3,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        total: 44.5,
        overOdds: -110,
        underOdds: -110,
        homeMoneyline: -150,
        awayMoneyline: 130,
      },
    },
    report: {
      game: {
        id: overrides.id ?? "g1",
        league: overrides.league ?? "nfl",
        season: 2026,
        week: 1,
        gameType: "REG",
        kickoffIso: overrides.kickoffIso ?? "2026-09-07T17:00:00.000Z",
        home: { id: `nfl:${home}`, abbreviation: home, name: home },
        away: { id: `nfl:${away}`, abbreviation: away, name: away },
        neutralSite: false,
      },
      projection: projection(overrides.margin ?? 6, overrides.total ?? 44),
      ratings: {
        home: rating(home, overrides.homeGames ?? 8),
        away: rating(away, overrides.awayGames ?? 8),
      },
      adjustments: {
        homeField: 2.2,
        rest: 0,
        weatherTotal: 0,
        qbHome: 0,
        qbAway: 0,
        userHome: 0,
        userAway: 0,
      },
      priced: overrides.priced,
      diagnostics: [],
      confidence: { score: overrides.confidence ?? 72, reasons: [] },
      engine: "srs-fallback",
      signals: [],
    },
    bestBet: overrides.priced[0] ?? null,
  };
}

describe("best-bet eligibility", () => {
  it("rejects raw EV monsters that disagree with the market", () => {
    const monster = priced({
      label: "TLSA ML",
      betType: "moneyline",
      side: "home",
      americanOdds: 425,
      handicappedP: 0.658,
      impliedS: 0.1905,
    });
    const view = row({
      league: "ncaaf",
      home: "TLSA",
      away: "OKST",
      market: { homeSpread: 13.5, total: 55.5, homeMoneyline: 425, awayMoneyline: -550 },
      margin: 7.1,
      priced: [monster],
    });
    expect(monster.evPerUnit).toBeGreaterThan(2);
    expect(isBestBetEligible(view, monster)).toBe(false);
  });

  it("keeps a modest aligned NCAAF spread", () => {
    const pick = priced({
      label: "HOM -3",
      betType: "spread",
      handicappedP: 0.575,
    });
    const view = row({
      league: "ncaaf",
      priced: [pick],
      margin: 6,
      market: { homeSpread: -3, total: 44.5 },
    });
    expect(isBestBetEligible(view, pick)).toBe(true);
    expect(pickQuality(view, pick)).toBeGreaterThan(1);
  });

  it("selects the trusted spread instead of a raw-EV moneyline as the board pick", () => {
    const moneyline = priced({
      label: "TOL ML",
      betType: "moneyline",
      side: "away",
      americanOdds: 320,
      handicappedP: 0.636,
      impliedS: 0.238,
    });
    const spread = priced({
      label: "TOL +10",
      betType: "spread",
      side: "away",
      handicappedP: 0.814,
    });
    const view = row({
      league: "ncaaf",
      home: "MSU",
      away: "TOL",
      priced: [moneyline, spread],
      margin: -6,
      market: { homeSpread: -10, total: 47.5 },
    });
    expect(isBestBetEligible(view, moneyline)).toBe(false);
    expect(isBestBetEligible(view, spread)).toBe(false);
    expect(selectTrustedBestBet(view)).toBeNull();
  });

  it("ranks a market-aligned edge above a huge disagreement with flashy EV", () => {
    const aligned = priced({
      label: "HOM -3",
      betType: "spread",
      handicappedP: 0.575,
    });
    const alignedRow = row({
      id: "aligned",
      league: "ncaaf",
      priced: [aligned],
      margin: 6,
      market: { homeSpread: -3, total: 44.5 },
    });
    const flashy = priced({
      label: "AWY +3",
      betType: "spread",
      side: "away",
      handicappedP: 0.78,
      impliedS: 0.5238,
    });
    const flashyRow = row({
      id: "flashy",
      league: "ncaaf",
      priced: [flashy],
      margin: -14,
      market: { homeSpread: -3, total: 44.5 },
    });
    expect(isBestBetEligible(alignedRow, aligned)).toBe(true);
    expect(isBestBetEligible(flashyRow, flashy)).toBe(false);
    expect(pickQuality(alignedRow, aligned)).toBeGreaterThan(pickQuality(flashyRow, flashy));
  });

  it("sits an aligned NFL spread on the live desk", () => {
    const pick = priced({
      label: "HOM -3",
      betType: "spread",
      handicappedP: 0.575,
    });
    const view = row({
      league: "nfl",
      priced: [pick],
      margin: 6,
      market: { homeSpread: -3, total: 44.5 },
    });
    expect(isBestBetEligible(view, pick)).toBe(false);
    expect(selectTrustedBestBet(view)).toBeNull();
  });
});

describe("parlay combo builder", () => {
  it("never pairs two legs from the same game and one-per-game best bets stay unique", () => {
    const games = [
      row({
        id: "g1",
        league: "ncaaf",
        kickoffIso: "2026-09-07T17:00:00.000Z",
        priced: [
          priced({ label: "HOM -3", betType: "spread", handicappedP: 0.58 }),
          priced({
            label: "Over 44.5",
            betType: "total",
            side: "over",
            handicappedP: 0.59,
          }),
        ],
        margin: 6,
        total: 49,
        market: { homeSpread: -3, total: 44.5 },
      }),
      row({
        id: "g2",
        league: "ncaaf",
        home: "H2",
        away: "A2",
        kickoffIso: "2026-09-07T20:00:00.000Z",
        priced: [priced({ label: "H2 -3", betType: "spread", handicappedP: 0.57 })],
        margin: 6.5,
        market: { homeSpread: -3, total: 44.5 },
      }),
      row({
        id: "g3",
        league: "ncaaf",
        home: "H3",
        away: "A3",
        kickoffIso: "2026-09-07T23:00:00.000Z",
        priced: [
          priced({
            label: "Under 44.5",
            betType: "total",
            side: "under",
            handicappedP: 0.58,
          }),
        ],
        margin: 1,
        total: 40,
        market: { homeSpread: -1, total: 44.5 },
      }),
    ];
    const eligible = collectEligiblePicks(games);
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    const singles = bestBetsFromPicks(eligible);
    expect(new Set(singles.map((pick) => pick.gameId)).size).toBe(singles.length);
    const combos = buildParlayCombos(eligible, { maxPool: 8, sameDateOnly: true });
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) {
      const ids = combo.legs.map((leg) => leg.gameId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(combo.plusEv).toBe(true);
      expect(combo.sameDate).toBe(true);
    }
  });
});
