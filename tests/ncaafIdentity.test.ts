import { describe, expect, it } from "vitest";
import {
  blendLiveNcaafRatings,
  continuityDecision,
  continuityLambda,
  isNewHeadCoach,
  NCAAF_CONTINUITY,
  NCAAF_NEW_HEAD_COACHES_2026,
} from "@/src/lib/ncaafIdentity";
import { fitTeamRatings } from "@/src/lib/ratings";
import type { CompletedGame, TeamRef } from "@/src/lib/types";

function team(abbr: string): TeamRef {
  return { id: `ncaaf:${abbr}`, abbreviation: abbr, name: abbr };
}

function game(args: {
  id: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  week: number;
  season: number;
}): CompletedGame {
  return {
    id: args.id,
    league: "ncaaf",
    season: args.season,
    week: args.week,
    gameType: "REG",
    kickoffIso: `${args.season}-09-${String(args.week).padStart(2, "0")}T17:00:00Z`,
    home: team(args.home),
    away: team(args.away),
    homeScore: args.hs,
    awayScore: args.as,
    neutralSite: false,
  };
}

function tape(): CompletedGame[] {
  return [
    game({ id: "p1", season: 2025, week: 1, home: "DOM", away: "BAD", hs: 49, as: 7 }),
    game({ id: "p2", season: 2025, week: 2, home: "MID", away: "BAD", hs: 31, as: 17 }),
    game({ id: "p3", season: 2025, week: 3, home: "DOM", away: "MID", hs: 42, as: 10 }),
    game({ id: "p4", season: 2025, week: 4, home: "BAD", away: "MID", hs: 14, as: 27 }),
    game({ id: "p5", season: 2025, week: 5, home: "BAD", away: "DOM", hs: 3, as: 45 }),
    game({ id: "p6", season: 2025, week: 6, home: "MID", away: "DOM", hs: 13, as: 35 }),
    game({ id: "c1", season: 2026, week: 1, home: "BAD", away: "DOM", hs: 41, as: 10 }),
    game({ id: "c2", season: 2026, week: 2, home: "DOM", away: "MID", hs: 7, as: 38 }),
  ];
}

describe("continuityLambda", () => {
  it("uses the new-HC prior even when tape matches last year", () => {
    expect(continuityLambda({ newHeadCoach: true, priorNet: 12, observedNet: 12 })).toBe(
      NCAAF_CONTINUITY.newHeadCoachLambda,
    );
  });

  it("keeps most of a confirmed résumé", () => {
    expect(continuityLambda({ newHeadCoach: false, priorNet: 13, observedNet: 15 })).toBe(
      NCAAF_CONTINUITY.confirmedLambda,
    );
  });

  it("drops a rejected résumé", () => {
    expect(continuityLambda({ newHeadCoach: false, priorNet: 9, observedNet: -1.5 })).toBe(
      NCAAF_CONTINUITY.rejectedLambda,
    );
  });

  it("interpolates between confirm and reject deltas", () => {
    const mid = continuityLambda({ newHeadCoach: false, priorNet: 0, observedNet: 8 });
    expect(mid).toBeGreaterThan(NCAAF_CONTINUITY.rejectedLambda);
    expect(mid).toBeLessThan(NCAAF_CONTINUITY.confirmedLambda);
    expect(mid).toBeCloseTo(0.4, 5);
  });
});

describe("isNewHeadCoach", () => {
  it("flags 2026 LSU and not Alabama", () => {
    expect(isNewHeadCoach("LSU", 2026)).toBe(true);
    expect(isNewHeadCoach("ALA", 2026)).toBe(false);
  });

  it("does not apply the 2026 table to another season", () => {
    expect(isNewHeadCoach("LSU", 2025)).toBe(false);
  });

  it("has unique 2026 abbreviations", () => {
    expect(new Set(NCAAF_NEW_HEAD_COACHES_2026).size).toBe(NCAAF_NEW_HEAD_COACHES_2026.length);
    for (const abbr of NCAAF_NEW_HEAD_COACHES_2026) {
      expect(isNewHeadCoach(abbr, 2026)).toBe(true);
    }
  });

  it("rejects empty abbreviations", () => {
    expect(() => isNewHeadCoach("", 2026)).toThrow(/abbreviation/);
  });
});

describe("blendLiveNcaafRatings", () => {
  it("lets 2026 tape dominate a same-coach résumé collapse", () => {
    const games = tape();
    const prior = fitTeamRatings(games.filter((row) => row.season === 2025), "ncaaf");
    const observed = fitTeamRatings(games.filter((row) => row.season === 2026), "ncaaf");
    const live = blendLiveNcaafRatings(games, { newHeadCoachAbbreviations: new Set() });
    const priorDom = prior.find((row) => row.team.abbreviation === "DOM");
    const obsDom = observed.find((row) => row.team.abbreviation === "DOM");
    const liveDom = live.find((row) => row.team.abbreviation === "DOM");
    expect(priorDom && obsDom && liveDom).toBeTruthy();
    const expected = 0.2 * priorDom!.net + 0.8 * obsDom!.net;
    expect(liveDom!.net).toBeCloseTo(expected, 6);
    expect(liveDom!.net).toBeLessThan(priorDom!.net);
  });

  it("mostly follows 2026 when the head coach changed", () => {
    const games = tape();
    const prior = fitTeamRatings(games.filter((row) => row.season === 2025), "ncaaf");
    const observed = fitTeamRatings(games.filter((row) => row.season === 2026), "ncaaf");
    const live = blendLiveNcaafRatings(games, { newHeadCoachAbbreviations: new Set(["DOM"]) });
    const priorDom = prior.find((row) => row.team.abbreviation === "DOM");
    const obsDom = observed.find((row) => row.team.abbreviation === "DOM");
    const liveDom = live.find((row) => row.team.abbreviation === "DOM");
    expect(priorDom && obsDom && liveDom).toBeTruthy();
    const expected = 0.1 * priorDom!.net + 0.9 * obsDom!.net;
    expect(liveDom!.net).toBeCloseTo(expected, 6);
  });

  it("keeps most of a confirmed 2025 identity", () => {
    const games = [
      game({ id: "p1", season: 2025, week: 1, home: "ALA", away: "WK", hs: 42, as: 10 }),
      game({ id: "p2", season: 2025, week: 2, home: "WK", away: "ALA", hs: 13, as: 35 }),
      game({ id: "p3", season: 2025, week: 3, home: "ALA", away: "MID", hs: 31, as: 17 }),
      game({ id: "p4", season: 2025, week: 4, home: "MID", away: "WK", hs: 24, as: 20 }),
      game({ id: "c1", season: 2026, week: 1, home: "ALA", away: "WK", hs: 38, as: 14 }),
      game({ id: "c2", season: 2026, week: 2, home: "MID", away: "ALA", hs: 17, as: 28 }),
      game({ id: "c3", season: 2026, week: 3, home: "ALA", away: "MID", hs: 30, as: 16 }),
      game({ id: "c4", season: 2026, week: 4, home: "WK", away: "ALA", hs: 10, as: 34 }),
    ];
    const prior = fitTeamRatings(games.filter((row) => row.season === 2025), "ncaaf");
    const observed = fitTeamRatings(games.filter((row) => row.season === 2026), "ncaaf");
    const live = blendLiveNcaafRatings(games, { newHeadCoachAbbreviations: new Set() });
    const priorAla = prior.find((row) => row.team.abbreviation === "ALA");
    const obsAla = observed.find((row) => row.team.abbreviation === "ALA");
    const liveAla = live.find((row) => row.team.abbreviation === "ALA");
    expect(priorAla && obsAla && liveAla).toBeTruthy();
    const delta = Math.abs(obsAla!.net - priorAla!.net);
    expect(delta).toBeLessThanOrEqual(NCAAF_CONTINUITY.confirmDelta);
    expect(continuityDecision({
      abbreviation: "ALA",
      season: 2026,
      priorNet: priorAla!.net,
      observedNet: obsAla!.net,
      newHeadCoachAbbreviations: new Set(),
    }).reason).toBe("confirmed");
    const expected = 0.6 * priorAla!.net + 0.4 * obsAla!.net;
    expect(liveAla!.net).toBeCloseTo(expected, 6);
  });

  it("returns the 2025 rating when a team has no 2026 games", () => {
    const games = [
      game({ id: "p1", season: 2025, week: 1, home: "HOLD", away: "WK", hs: 31, as: 14 }),
      game({ id: "p2", season: 2025, week: 2, home: "WK", away: "HOLD", hs: 10, as: 27 }),
      game({ id: "c1", season: 2026, week: 1, home: "WK", away: "MID", hs: 17, as: 24 }),
    ];
    const prior = fitTeamRatings(games.filter((row) => row.season === 2025), "ncaaf");
    const live = blendLiveNcaafRatings(games);
    const priorHold = prior.find((row) => row.team.abbreviation === "HOLD");
    const liveHold = live.find((row) => row.team.abbreviation === "HOLD");
    expect(priorHold && liveHold).toBeTruthy();
    expect(liveHold!.net).toBeCloseTo(priorHold!.net, 10);
  });

  it("rejects a non-array games argument", () => {
    expect(() => blendLiveNcaafRatings(null as unknown as CompletedGame[])).toThrow(/array/);
  });
});
