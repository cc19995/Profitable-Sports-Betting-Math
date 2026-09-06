import { describe, expect, it } from "vitest";
import { expectedScores, fitTeamRatings } from "@/src/lib/ratings";
import type { CompletedGame, TeamRef } from "@/src/lib/types";

function team(abbr: string): TeamRef {
  return { id: `nfl:${abbr}`, abbreviation: abbr, name: abbr };
}

function game(args: {
  id: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  week?: number;
}): CompletedGame {
  return {
    id: args.id,
    league: "nfl",
    season: 2025,
    week: args.week ?? 1,
    gameType: "REG",
    kickoffIso: `2025-09-${String(args.week ?? 1).padStart(2, "0")}T17:00:00Z`,
    home: team(args.home),
    away: team(args.away),
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
});
