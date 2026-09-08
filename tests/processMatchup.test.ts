import { describe, expect, it } from "vitest";
import { handicapMatchup } from "@/src/lib/matchup";
import {
  processCard,
  processMatchupAdjustment,
  pythagoreanWins,
  westCoastEarlyPenalty,
} from "@/src/lib/processMatchup";
import { rowsToFactors } from "@/src/data/cfbFactors";
import { buildNflFactorsAt } from "@/src/data/nflFactors";
import { consensusFromBooks } from "@/src/lib/weeklyEdge";
import { fitTeamRatings } from "@/src/lib/ratings";
import { PROFIT_GATE } from "@/src/lib/profit";
import type { TeamRating, UpcomingGame } from "@/src/lib/types";
import type { TeamFactors } from "@/src/lib/rithmm/types";

function house(partial: Partial<TeamFactors> & { teamId: string }): TeamFactors {
  return {
    abbreviation: partial.abbreviation ?? partial.teamId,
    name: partial.name ?? partial.teamId,
    sampleGames: partial.sampleGames ?? 10,
    asOfSeason: 2025,
    asOfWeek: 8,
    running: partial.running ?? { offense: 50, defense: 50 },
    passing: partial.passing ?? { offense: 50, defense: 50 },
    offense: partial.offense ?? 50,
    defense: partial.defense ?? 50,
    ranks: partial.ranks ?? 50,
    pace: partial.pace ?? 62,
    source: "test",
    ...partial,
  };
}

function rating(abbr: string): TeamRating {
  return {
    team: { id: `nfl:${abbr}`, abbreviation: abbr, name: abbr },
    offense: 2,
    defense: 1,
    net: 3,
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

describe("process matchup", () => {
  it("fades a team with unsustainable fumble luck and caps the move", () => {
    const lucky = house({
      teamId: "nfl:H",
      process: processCard({ turnoverLuck: 80, successOff: 50, redZoneOff: 50 }),
    });
    const average = house({
      teamId: "nfl:A",
      process: processCard({ turnoverLuck: 50 }),
    });
    const adj = processMatchupAdjustment(lucky, average);
    expect(adj.luckHome).toBeLessThan(-0.45);
    expect(Math.abs(adj.homePoints)).toBeLessThanOrEqual(1.1);
  });

  it("gives home the points when its pass rush beats the away line", () => {
    const home = house({
      teamId: "nfl:H",
      process: processCard({ passRush: 82, protection: 70 }),
    });
    const away = house({
      teamId: "nfl:A",
      process: processCard({ passRush: 40, protection: 30 }),
    });
    const adj = processMatchupAdjustment(home, away);
    expect(adj.pressure).toBeGreaterThan(0.45);
    expect(adj.homePoints).toBeGreaterThan(0);
    expect(adj.awayPoints).toBeLessThan(0);
  });

  it("adds a small total when both offenses live in explosives", () => {
    const home = house({
      teamId: "nfl:H",
      process: processCard({ explosiveOff: 80, explosiveDef: 35 }),
    });
    const away = house({
      teamId: "nfl:A",
      process: processCard({ explosiveOff: 78, explosiveDef: 32 }),
    });
    const adj = processMatchupAdjustment(home, away);
    expect(adj.totalPoints).toBeGreaterThan(0.5);
    expect(adj.totalPoints).toBeLessThanOrEqual(1.6);
  });

  it("does not fire west-coast early on Thursday night UTC", () => {
    expect(
      westCoastEarlyPenalty({
        league: "nfl",
        awayAbbr: "SEA",
        kickoffIso: "2026-09-13T00:20:00Z",
      }),
    ).toBe(0);
  });

  it("applies a small body-clock prior for a Pacific road team at 1 PM ET", () => {
    expect(
      westCoastEarlyPenalty({
        league: "nfl",
        awayAbbr: "LAR",
        kickoffIso: "2026-09-13T17:00:00Z",
      }),
    ).toBe(-0.7);
  });

  it("feeds process points through handicapMatchup without a House engine", () => {
    const game: UpcomingGame = {
      id: "g-process",
      league: "nfl",
      season: 2026,
      week: 2,
      gameType: "REG",
      kickoffIso: "2026-09-13T17:00:00Z",
      home: { id: "nfl:BUF", abbreviation: "BUF", name: "Bills" },
      away: { id: "nfl:LAR", abbreviation: "LAR", name: "Rams" },
      neutralSite: false,
    };
    const lookup = (teamId: string): TeamFactors | undefined => {
      if (teamId.includes("BUF")) {
        return house({ teamId: "nfl:BUF", process: processCard({ passRush: 82, protection: 70 }) });
      }
      if (teamId.includes("LAR")) {
        return house({ teamId: "nfl:LAR", process: processCard({ passRush: 40, protection: 30 }) });
      }
      return undefined;
    };
    const withProcess = handicapMatchup({
      game,
      ratings: [rating("BUF"), rating("LAR")],
      factorLookup: lookup,
      priceWithHouse: false,
    });
    const baseline = handicapMatchup({
      game,
      ratings: [rating("BUF"), rating("LAR")],
      priceWithHouse: false,
    });
    expect(withProcess.engine).toBe("srs-fallback");
    expect(withProcess.projection.awayScore).toBeLessThan(baseline.projection.awayScore);
    expect(withProcess.diagnostics.some((row) => row.key === "travel")).toBe(true);
  });
});

describe("pythagorean diagnostic", () => {
  it("gives more expected wins to a team that outscores opponents", () => {
    expect(pythagoreanWins(240, 120, 8)).toBeGreaterThan(5);
    expect(pythagoreanWins(120, 240, 8)).toBeLessThan(3);
  });

  it("stores actual vs pythagorean wins on fitted ratings", () => {
    const team = (abbr: string) => ({ id: `nfl:${abbr}`, abbreviation: abbr, name: abbr });
    const ratings = fitTeamRatings(
      [
        {
          id: "1",
          league: "nfl",
          season: 2025,
          week: 1,
          gameType: "REG",
          kickoffIso: "2025-09-07T17:00:00Z",
          home: team("STR"),
          away: team("WK"),
          homeScore: 31,
          awayScore: 28,
          neutralSite: false,
        },
        {
          id: "2",
          league: "nfl",
          season: 2025,
          week: 2,
          gameType: "REG",
          kickoffIso: "2025-09-14T17:00:00Z",
          home: team("WK"),
          away: team("STR"),
          homeScore: 20,
          awayScore: 23,
          neutralSite: false,
        },
      ],
      "nfl",
    );
    const strong = ratings.find((row) => row.team.abbreviation === "STR");
    expect(strong?.wins).toBe(2);
    expect(strong?.oneScoreGames).toBe(2);
    expect(strong?.pythagoreanWins).toBeGreaterThan(0);
  });
});

describe("factor process cards", () => {
  it("attaches NFL process rates from extra nflverse columns", () => {
    const built = buildNflFactorsAt(
      [
        {
          season: 2025,
          week: 1,
          team: "SEA",
          opponent: "NE",
          gameId: "g1",
          attempts: 30,
          carries: 25,
          passingEpa: 8,
          rushingEpa: 2,
          cpoe: 2,
          sacks: 1,
          defSacks: 4,
          defInt: 1,
          passing20: 5,
          rushing20: 2,
          passingFirstDowns: 12,
          rushingFirstDowns: 6,
          defQbHits: 8,
          fumblesLost: 0,
          fumblesTotal: 1,
          defFumblesForced: 3,
          fumbleRecoveryOpp: 3,
        },
        {
          season: 2025,
          week: 1,
          team: "NE",
          opponent: "SEA",
          gameId: "g1",
          attempts: 30,
          carries: 25,
          passingEpa: -4,
          rushingEpa: -1,
          cpoe: -3,
          sacks: 3,
          defSacks: 1,
          defInt: 0,
          passing20: 1,
          rushing20: 0,
          passingFirstDowns: 6,
          rushingFirstDowns: 3,
          defQbHits: 2,
          fumblesLost: 2,
          fumblesTotal: 2,
          defFumblesForced: 1,
          fumbleRecoveryOpp: 0,
        },
      ],
      2025,
      2,
    );
    const sea = built.find((row) => row.abbreviation === "SEA");
    const ne = built.find((row) => row.abbreviation === "NE");
    expect(sea?.process).toBeDefined();
    expect(sea?.process?.explosiveOff ?? 0).toBeGreaterThan(ne?.process?.explosiveOff ?? 0);
    expect(sea?.process?.turnoverLuck ?? 0).toBeGreaterThan(50);
  });

  it("attaches CFB success/explosive/havoc when the weekly summary has those columns", () => {
    const slice = [
      {
        season: 2025,
        throughWeek: 1,
        teamId: "1",
        name: "Alpha",
        games: 2,
        passOff: 0.2,
        rushOff: 0.1,
        passDef: -0.1,
        rushDef: 0,
        offEpa: 0.2,
        defEpa: -0.1,
        netEpa: 0.3,
        pace: 72,
        successOff: 0.52,
        successDef: 0.35,
        explosiveOff: 0.18,
        explosiveDef: 0.08,
        havocOff: 0.1,
        havocDef: 0.22,
        redZoneOff: 0.4,
        redZoneDef: 0.7,
        thirdDownOff: 0.45,
        thirdDownDef: 0.3,
        passRateOff: 0.58,
        stuffedOff: 0.12,
        stuffedDef: 0.22,
      },
      {
        season: 2025,
        throughWeek: 1,
        teamId: "2",
        name: "Beta",
        games: 2,
        passOff: -0.1,
        rushOff: 0,
        passDef: 0.2,
        rushDef: 0.1,
        offEpa: -0.1,
        defEpa: 0.2,
        netEpa: -0.3,
        pace: 68,
        successOff: 0.36,
        successDef: 0.5,
        explosiveOff: 0.07,
        explosiveDef: 0.16,
        havocOff: 0.2,
        havocDef: 0.09,
        redZoneOff: 0.8,
        redZoneDef: 0.35,
        thirdDownOff: 0.28,
        thirdDownDef: 0.48,
        passRateOff: 0.48,
        stuffedOff: 0.22,
        stuffedDef: 0.11,
      },
    ];
    const factors = rowsToFactors(slice, 2025, 1);
    const alpha = factors.find((row) => row.abbreviation === "Alpha");
    const beta = factors.find((row) => row.abbreviation === "Beta");
    expect(alpha?.process?.successOff ?? 0).toBeGreaterThan(beta?.process?.successOff ?? 0);
    expect(alpha?.process?.passRush ?? 0).toBeGreaterThan(beta?.process?.passRush ?? 0);
    const adj = processMatchupAdjustment(alpha, beta);
    expect(adj.notes.length).toBeGreaterThan(0);
  });
});

describe("market diagnostics stay off P", () => {
  it("stores public ticket/money split when present", () => {
    const market = consensusFromBooks({
      books: [
        { bookId: 15, book: "DraftKings", homeSpread: -3.5, spreadHomePublic: 72, spreadHomeMoney: 48 },
        { bookId: 30, book: "FanDuel", homeSpread: -3, spreadHomePublic: 70, spreadHomeMoney: 50 },
      ],
      espn: { homeMoneyline: -180, openHomeMoneyline: -150 },
    });
    expect(market.publicHomeSpreadPct).toBe(71);
    expect(market.ticketMoneyDivergence).toBeGreaterThan(15);
    expect(market.espnMlHomeImpliedMove).toBeGreaterThan(0);
  });

  it("does not retune the live profit gate", () => {
    expect(PROFIT_GATE.allowMoneyline).toBe(false);
    expect(PROFIT_GATE.minEdge).toBe(0.04);
    expect(PROFIT_GATE.minAlignment).toBe(0.8);
    expect(PROFIT_GATE.maxEvPerUnit).toBe(0.45);
    expect(PROFIT_GATE.allowedLeagues).toEqual(["ncaaf"]);
  });
});
