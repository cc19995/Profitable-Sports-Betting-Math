import { describe, expect, it } from "vitest";
import { handicapMatchup } from "@/src/lib/matchup";
import { weatherTotalAdjustment } from "@/src/lib/adjustments";
import { expectedScores } from "@/src/lib/ratings";
import {
  buildGameEdgeContext,
  consensusFromBooks,
  equivalentAbbr,
  newsMatchesTeam,
  newsQbFlag,
  scoreTeamInjuries,
  tagNewsText,
  weatherFromForecast,
  type ParsedInjury,
} from "@/src/lib/weeklyEdge";
import { parseInjuryPayload } from "@/src/data/weeklyIngest";
import { espnSitePath } from "@/src/data/espn";
import type { NewsItem, TeamRating, UpcomingGame } from "@/src/lib/types";

function team(abbr: string, name = abbr) {
  return { id: `nfl:${abbr}`, abbreviation: abbr, name };
}

function listing(partial: Partial<ParsedInjury> & { player: string; position: string; status: string }): ParsedInjury {
  return partial;
}

function rating(abbr: string, offense: number, defense: number): TeamRating {
  return {
    team: team(abbr),
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

describe("injury scoring", () => {
  it("applies a starter-quality QB Out as a several-point offensive drop", () => {
    const impact = scoreTeamInjuries({
      league: "nfl",
      team: team("ATL", "Atlanta Falcons"),
      listings: [
        listing({
          player: "Michael Penix Jr.",
          position: "QB",
          status: "Out",
          comment: "Inactive for Week 1",
        }),
      ],
    });
    expect(impact.qbPoints).toBeCloseTo(-3.8, 5);
    expect(impact.offensePoints).toBe(0);
  });

  it("ignores Active listings", () => {
    const impact = scoreTeamInjuries({
      league: "nfl",
      team: team("SEA"),
      listings: [listing({ player: "Healthy Starter", position: "WR", status: "Active" })],
    });
    expect(impact.offensePoints).toBe(0);
    expect(impact.listings[0]?.side).toBe("ignored");
  });

  it("weights Questionable at 35% of Out", () => {
    const impact = scoreTeamInjuries({
      league: "nfl",
      team: team("DAL"),
      listings: [listing({ player: "QB1", position: "QB", status: "Questionable" })],
    });
    expect(impact.qbPoints).toBeCloseTo(-3.8 * 0.35, 5);
  });

  it("uses a small IR-only QB prior and ignores IR when another QB is Out", () => {
    const irOnly = scoreTeamInjuries({
      league: "nfl",
      team: team("CHI"),
      listings: [listing({ player: "Backup", position: "QB", status: "Injured Reserve" })],
    });
    expect(irOnly.qbPoints).toBeCloseTo(-0.4, 5);

    const starterOut = scoreTeamInjuries({
      league: "nfl",
      team: team("CHI"),
      listings: [
        listing({ player: "Starter", position: "QB", status: "Out" }),
        listing({ player: "Backup", position: "QB", status: "Injured Reserve" }),
      ],
    });
    expect(starterOut.qbPoints).toBeCloseTo(-3.8, 5);
  });

  it("adds an OL cluster premium for three linemen out", () => {
    const one = scoreTeamInjuries({
      league: "nfl",
      team: team("KC"),
      listings: [listing({ player: "LT", position: "OT", status: "Out" })],
    });
    const three = scoreTeamInjuries({
      league: "nfl",
      team: team("KC"),
      listings: [
        listing({ player: "LT", position: "OT", status: "Out" }),
        listing({ player: "LG", position: "G", status: "Out" }),
        listing({ player: "C", position: "C", status: "Out" }),
      ],
    });
    expect(three.offensePoints).toBeGreaterThan(one.offensePoints + 1);
    expect(three.clusterNote).toMatch(/3/);
  });

  it("indexes Penix onto ATL from the ESPN injury payload shape", () => {
    const index = parseInjuryPayload("nfl", {
      injuries: [
        {
          id: "1",
          displayName: "Atlanta Falcons",
          injuries: [
            {
              status: "Out",
              shortComment: "Inactive Week 1",
              athlete: {
                displayName: "Michael Penix Jr.",
                position: { abbreviation: "QB" },
                team: { id: "1", abbreviation: "ATL", displayName: "Atlanta Falcons" },
              },
            },
          ],
        },
      ],
    });
    const rows = index.byAbbr.get("atl");
    expect(rows?.[0]?.player).toBe("Michael Penix Jr.");
    const scored = scoreTeamInjuries({
      league: "nfl",
      team: team("ATL", "Atlanta Falcons"),
      listings: rows ?? [],
    });
    expect(scored.qbPoints).toBeCloseTo(-3.8, 5);
  });
});

describe("weather and market", () => {
  it("zeroes indoor weather even with wind", () => {
    expect(weatherTotalAdjustment({ indoor: true, windMph: 25, precipMm: 8 })).toBe(0);
    expect(weatherFromForecast({ indoor: true, windMph: 30, precipProbability: 90 }).totalAdjustment).toBe(0);
  });

  it("trims outdoor totals more for wind plus rain than for wind alone", () => {
    const wind = weatherTotalAdjustment({ windMph: 20 });
    const both = weatherTotalAdjustment({ windMph: 20, precipProbability: 80, precipMm: 3 });
    expect(wind).toBeCloseTo(-1.8, 5);
    expect(both).toBeLessThan(wind);
  });

  it("takes a multi-book median and does not treat disagreement as a projection input", () => {
    const market = consensusFromBooks({
      books: [
        { bookId: 15, book: "DraftKings", homeSpread: -3.5, total: 44.5 },
        { bookId: 30, book: "FanDuel", homeSpread: -3, total: 44 },
        { bookId: 79, book: "Circa", homeSpread: -3.5, total: 45 },
      ],
      espn: { homeSpread: -3.5, openHomeSpread: -2.5, total: 44.5, openTotal: 45 },
    });
    expect(market.consensusHomeSpread).toBe(-3.5);
    expect(market.espnSpreadMove).toBe(-1);
    expect(market.steamHint).toBe(false);
  });
});

describe("news and game context", () => {
  it("tags injury headlines and only flags a missing QB once", () => {
    expect(tagNewsText("Falcons QB ruled out with a knee injury")).toEqual(expect.arrayContaining(["qb", "injury"]));
    const items: NewsItem[] = [
      {
        headline: "Falcons QB ruled out with a knee injury",
        teamAbbrs: ["ATL"],
        tags: ["qb", "injury"],
      },
    ];
    expect(newsQbFlag(items, team("ATL", "Atlanta Falcons"), false)).toBe(true);
    expect(newsQbFlag(items, team("ATL", "Atlanta Falcons"), true)).toBe(false);
  });

  it("does not treat SEA as a substring of season", () => {
    const item: NewsItem = {
      headline: "How to bet the 2026 NFL season",
      teamAbbrs: [],
      tags: ["other"],
    };
    expect(newsMatchesTeam(item, team("SEA", "Seattle Seahawks"))).toBe(false);
    expect(newsMatchesTeam({ ...item, headline: "Seahawks list starters" }, team("SEA", "Seattle Seahawks"))).toBe(
      true,
    );
  });

  it("moves the home projection down when the home QB is out", () => {
    const game: UpcomingGame = {
      id: "nfl:1",
      league: "nfl",
      season: 2026,
      week: 1,
      gameType: "REG",
      kickoffIso: "2026-09-14T17:00:00Z",
      home: team("ATL", "Atlanta Falcons"),
      away: team("PIT", "Pittsburgh Steelers"),
      neutralSite: false,
      indoor: true,
      roof: "dome",
      market: { homeSpread: -2.5, total: 44.5, homeSpreadOdds: -110, awaySpreadOdds: -110 },
    };
    const edge = buildGameEdgeContext({
      game,
      homeInjuries: [listing({ player: "Michael Penix Jr.", position: "QB", status: "Out" })],
      awayInjuries: [],
      weather: weatherFromForecast({ indoor: true, roof: "dome" }),
      books: [{ bookId: 15, book: "DraftKings", homeSpread: -2.5, total: 44.5 }],
      news: [],
    });
    expect(edge.scoreAdjustments.qbHome).toBeCloseTo(-3.8, 5);
    expect(edge.weather.totalAdjustment).toBe(0);

    const withEdge = handicapMatchup({
      game: { ...game, edge },
      ratings: [rating("ATL", 2, 1), rating("PIT", 2, 1)],
    });
    const without = handicapMatchup({
      game,
      ratings: [rating("ATL", 2, 1), rating("PIT", 2, 1)],
    });
    expect(withEdge.projection.homeScore).toBeLessThan(without.projection.homeScore - 3);
    expect(withEdge.adjustments.qbHome).toBeCloseTo(-3.8, 5);
  });

  it("feeds injury points through expectedScores", () => {
    const home = rating("ATL", 3, 1);
    const away = rating("PIT", 2, 1);
    const base = expectedScores({ home, away, league: "nfl" });
    const adj = expectedScores({ home, away, league: "nfl", qbHome: -3.8 });
    expect(adj.homeScore).toBeCloseTo(base.homeScore - 3.8, 5);
  });
});

describe("aliases and espn hosts", () => {
  it("equates ESPN LAR/JAX/WSH with Action Network LA/JAC/WAS", () => {
    expect(equivalentAbbr("LAR", "LA")).toBe(true);
    expect(equivalentAbbr("JAX", "JAC")).toBe(true);
    expect(equivalentAbbr("WSH", "WAS")).toBe(true);
    expect(equivalentAbbr("SEA", "SEATTLE")).toBe(false);
  });
  it("prefers the site.web.api host that is reachable from this environment", () => {
    expect(espnSitePath("nfl", "injuries")).toContain("site.web.api.espn.com");
    expect(espnSitePath("ncaaf", "news?limit=50")).toContain("college-football/news");
  });
});
