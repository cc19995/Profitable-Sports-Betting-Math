import { describe, expect, it } from "vitest";
import { getHouseModel, normalizeWeights } from "@/src/lib/rithmm/house";
import { projectHouseScores } from "@/src/lib/rithmm/project";
import { scoresFromRaw, scoreToZ } from "@/src/lib/rithmm/normalize";
import { selectCfbSlice } from "@/src/data/cfbFactors";
import { buildNflFactorsAt } from "@/src/data/nflFactors";
import type { TeamFactors } from "@/src/lib/rithmm/types";

function factors(partial: Partial<TeamFactors> & { teamId: string }): TeamFactors {
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

describe("house model", () => {
  it("normalizes slider weights to 1", () => {
    const w = normalizeWeights({ running: 2, passing: 2, offense: 2, defense: 2, ranks: 2 });
    expect(Object.values(w).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  });

  it("uses different House weights for NFL and NCAAF", () => {
    expect(getHouseModel("nfl").weights.passing).toBeGreaterThan(getHouseModel("ncaaf").weights.passing);
    expect(getHouseModel("ncaaf").weights.running).toBeGreaterThan(getHouseModel("nfl").weights.running);
  });

  it("projects equal clubs to home-field only", () => {
    const avg = factors({ teamId: "nfl:AAA" });
    const scored = projectHouseScores({
      home: avg,
      away: factors({ teamId: "nfl:BBB" }),
      league: "nfl",
      adjustments: { homeField: 1.9, rest: 0, weatherTotal: 0, qbHome: 0, qbAway: 0, userHome: 0, userAway: 0 },
    });
    expect(scored.homeScore - scored.awayScore).toBeCloseTo(1.9, 5);
    expect(scored.engine).toBe("house-epa");
  });

  it("moves the spread when passing mismatches", () => {
    const home = factors({ teamId: "nfl:H", passing: { offense: 80, defense: 50 } });
    const away = factors({ teamId: "nfl:A", passing: { offense: 50, defense: 35 } });
    const scored = projectHouseScores({
      home,
      away,
      league: "nfl",
      adjustments: { homeField: 0, rest: 0, weatherTotal: 0, qbHome: 0, qbAway: 0, userHome: 0, userAway: 0 },
    });
    expect(scored.homeScore - scored.awayScore).toBeGreaterThan(2);
  });
});

describe("factor scoring", () => {
  it("maps a high raw EPA to a score above 50", () => {
    const scores = scoresFromRaw(new Map([
      ["a", 0.2],
      ["b", 0],
      ["c", -0.2],
    ]));
    expect(scores.get("a") ?? 0).toBeGreaterThan(50);
    expect(scores.get("c") ?? 0).toBeLessThan(50);
    expect(scoreToZ(50)).toBeCloseTo(0, 8);
  });
});

describe("as-of week does not leak", () => {
  it("uses through_week = game week minus one for CFB", () => {
    const week2 = Array.from({ length: 40 }, (_, i) => ({
      season: 2025,
      throughWeek: 2,
      teamId: String(i),
      name: `Team ${i}`,
      games: 2,
      passOff: 0.1,
      rushOff: 0,
      passDef: 0,
      rushDef: 0,
      offEpa: 0.1,
      defEpa: 0,
      netEpa: 0.1,
      pace: 70,
    }));
    const week3 = week2.map((row) => ({ ...row, throughWeek: 3, games: 3, offEpa: 0.4 }));
    const selected = selectCfbSlice([...week2, ...week3], 2025, 3);
    expect(selected.asOfWeek).toBe(2);
    expect(selected.slice[0]?.offEpa).toBe(0.1);
  });

  it("skips a stub CFB season and uses the last full prior week", () => {
    const prior = Array.from({ length: 40 }, (_, i) => ({
      season: 2025,
      throughWeek: 16,
      teamId: String(i),
      name: `Team ${i}`,
      games: 12,
      passOff: 0.1,
      rushOff: 0,
      passDef: 0,
      rushDef: 0,
      offEpa: 0.1,
      defEpa: 0,
      netEpa: 0.1,
      pace: 70,
    }));
    const stub = [{
      season: 2026,
      throughWeek: 15,
      teamId: "9",
      name: "Arizona State",
      games: 2,
      passOff: 0,
      rushOff: 0,
      passDef: 0,
      rushDef: 0,
      offEpa: 0,
      defEpa: 0,
      netEpa: 0,
      pace: 62,
    }];
    const selected = selectCfbSlice([...prior, ...stub], 2026, 2);
    expect(selected.asOfSeason).toBe(2025);
    expect(selected.asOfWeek).toBe(16);
    expect(selected.slice.length).toBe(40);
  });

  it("excludes the current NFL week from the aggregate", () => {
    const built = buildNflFactorsAt(
      [
        { season: 2025, week: 1, team: "SEA", opponent: "NE", gameId: "g1", attempts: 30, carries: 25, passingEpa: 8, rushingEpa: 2, cpoe: 2, sacks: 1, defSacks: 2, defInt: 0 },
        { season: 2025, week: 1, team: "NE", opponent: "SEA", gameId: "g1", attempts: 30, carries: 25, passingEpa: -4, rushingEpa: -1, cpoe: -3, sacks: 3, defSacks: 1, defInt: 0 },
        { season: 2025, week: 2, team: "SEA", opponent: "NE", gameId: "g2", attempts: 30, carries: 25, passingEpa: 40, rushingEpa: 20, cpoe: 10, sacks: 0, defSacks: 4, defInt: 2 },
        { season: 2025, week: 2, team: "NE", opponent: "SEA", gameId: "g2", attempts: 30, carries: 25, passingEpa: -20, rushingEpa: -10, cpoe: -8, sacks: 5, defSacks: 0, defInt: 0 },
      ],
      2025,
      2,
    );
    const sea = built.find((row) => row.abbreviation === "SEA");
    expect(sea?.asOfWeek).toBe(1);
    expect(sea?.sampleGames).toBe(1);
  });
});
