import { describe, expect, it } from "vitest";
import { expectedScores, fitTeamRatings, NCAAF_IN_SEASON_FIT } from "@/src/lib/ratings";
import type { CompletedGame, League, TeamRef } from "@/src/lib/types";

function team(abbr: string, league: League = "nfl"): TeamRef {
  return { id: `${league}:${abbr}`, abbreviation: abbr, name: abbr };
}

function game(args: {
  id: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  week?: number;
  season?: number;
  league?: League;
}): CompletedGame {
  const league = args.league ?? "nfl";
  const season = args.season ?? 2025;
  const week = args.week ?? 1;
  return {
    id: args.id,
    league,
    season,
    week,
    gameType: "REG",
    kickoffIso: `${season}-09-${String(week).padStart(2, "0")}T17:00:00Z`,
    home: team(args.home, league),
    away: team(args.away, league),
    homeScore: args.hs,
    awayScore: args.as,
    neutralSite: false,
  };
}

function identityTape(): CompletedGame[] {
  return [
    game({ id: "p1", league: "ncaaf", season: 2025, week: 1, home: "DOM", away: "BAD", hs: 49, as: 7 }),
    game({ id: "p2", league: "ncaaf", season: 2025, week: 2, home: "MID", away: "BAD", hs: 31, as: 17 }),
    game({ id: "p3", league: "ncaaf", season: 2025, week: 3, home: "DOM", away: "MID", hs: 42, as: 10 }),
    game({ id: "p4", league: "ncaaf", season: 2025, week: 4, home: "BAD", away: "MID", hs: 14, as: 27 }),
    game({ id: "p5", league: "ncaaf", season: 2025, week: 5, home: "BAD", away: "DOM", hs: 3, as: 45 }),
    game({ id: "p6", league: "ncaaf", season: 2025, week: 6, home: "MID", away: "DOM", hs: 13, as: 35 }),
    game({ id: "c1", league: "ncaaf", season: 2026, week: 1, home: "BAD", away: "DOM", hs: 41, as: 10 }),
    game({ id: "c2", league: "ncaaf", season: 2026, week: 2, home: "DOM", away: "MID", hs: 7, as: 38 }),
  ];
}

describe("ratings", () => {
  it("rates a consistently dominant team above a weak one", () => {
    const games = [
      game({ id: "1", home: "STR", away: "WK", hs: 35, as: 10, week: 1 }),
      game({ id: "2", home: "WK", away: "STR", hs: 13, as: 31, week: 2 }),
      game({ id: "3", home: "STR", away: "MID", hs: 28, as: 17, week: 3 }),
      game({ id: "4", home: "MID", away: "WK", hs: 24, as: 20, week: 4 }),
      game({ id: "5", home: "MID", away: "STR", hs: 14, as: 27, week: 5 }),
      game({ id: "6", home: "WK", away: "MID", hs: 16, as: 23, week: 6 }),
    ];
    const ratings = fitTeamRatings(games, "nfl");
    const strong = ratings.find((row) => row.team.abbreviation === "STR");
    const weak = ratings.find((row) => row.team.abbreviation === "WK");
    expect(strong && weak).toBeTruthy();
    expect(strong!.net).toBeGreaterThan(weak!.net);
    const proj = expectedScores({ home: strong!, away: weak!, league: "nfl" });
    expect(proj.homeScore).toBeGreaterThan(proj.awayScore);
  });

  it("lets 2026 tape overwrite a sticky 2025 identity under the in-season fit", () => {
    const games = identityTape();
    const prior = fitTeamRatings(games, "ncaaf");
    const live = fitTeamRatings(games, "ncaaf", NCAAF_IN_SEASON_FIT);
    const priorDom = prior.find((row) => row.team.abbreviation === "DOM");
    const liveDom = live.find((row) => row.team.abbreviation === "DOM");
    const liveBad = live.find((row) => row.team.abbreviation === "BAD");
    expect(priorDom && liveDom && liveBad).toBeTruthy();
    expect(priorDom!.net).toBeGreaterThan(8);
    expect(liveDom!.net).toBeLessThan(priorDom!.net - 8);
    expect(liveBad!.net).toBeGreaterThan(liveDom!.net);
  });

  it("raises a 2026 improver relative to the default prior-heavy fit", () => {
    const games = identityTape();
    const prior = fitTeamRatings(games, "ncaaf");
    const live = fitTeamRatings(games, "ncaaf", NCAAF_IN_SEASON_FIT);
    const priorBad = prior.find((row) => row.team.abbreviation === "BAD");
    const liveBad = live.find((row) => row.team.abbreviation === "BAD");
    expect(priorBad && liveBad).toBeTruthy();
    expect(liveBad!.net).toBeGreaterThan(priorBad!.net + 6);
  });

  it("rejects invalid fit options", () => {
    const games = [game({ id: "1", home: "A", away: "B", hs: 24, as: 17 })];
    expect(() => fitTeamRatings(games, "ncaaf", { currentSeasonEmphasis: 0 })).toThrow(/currentSeasonEmphasis/);
    expect(() => fitTeamRatings(games, "ncaaf", { priorRetention: 1.2 })).toThrow(/priorRetention/);
    expect(() => fitTeamRatings(games, "ncaaf", { recencyHalfLifeGames: -1 })).toThrow();
    expect(() => fitTeamRatings(games, "ncaaf", { shrinkageK: 0 })).toThrow(/shrinkageK/);
  });
});
