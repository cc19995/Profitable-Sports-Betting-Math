import { describe, expect, it } from "vitest";
import { expectedScores, fitTeamRatings } from "@/src/lib/ratings";
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

  it("rejects invalid fit options", () => {
    const games = [game({ id: "1", home: "A", away: "B", hs: 24, as: 17 })];
    expect(() => fitTeamRatings(games, "ncaaf", { currentSeasonEmphasis: 0 })).toThrow(/currentSeasonEmphasis/);
    expect(() => fitTeamRatings(games, "ncaaf", { priorRetention: 1.2 })).toThrow(/priorRetention/);
    expect(() => fitTeamRatings(games, "ncaaf", { recencyHalfLifeGames: -1 })).toThrow();
    expect(() => fitTeamRatings(games, "ncaaf", { shrinkageK: 0 })).toThrow(/shrinkageK/);
  });
});
