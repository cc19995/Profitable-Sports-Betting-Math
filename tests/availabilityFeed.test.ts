import { describe, expect, it } from "vitest";
import {
  espnInjuryIsFresh,
  itemsFromOperatorReport,
  loadNcaafAvailabilityItems,
  mapEspnInjuriesToItems,
  mapEspnPosition,
  mapEspnStatus,
  parseOperatorAvailabilityFile,
} from "@/src/data/availabilityFeed";
import type { UpcomingGame } from "@/src/lib/types";

function game(): UpcomingGame {
  return {
    id: "ncaaf:401858229",
    league: "ncaaf",
    season: 2026,
    week: 3,
    gameType: "REG",
    kickoffIso: "2026-09-19T16:00:00Z",
    home: { id: "ncaaf:228", abbreviation: "CLEM", name: "Clemson" },
    away: { id: "ncaaf:153", abbreviation: "UNC", name: "North Carolina" },
    neutralSite: false,
  };
}

describe("ESPN injury mapping", () => {
  it("maps QB / WR / edge / OL and ignores other positions", () => {
    expect(mapEspnPosition("QB")).toBe("qb");
    expect(mapEspnPosition("WR")).toBe("wr");
    expect(mapEspnPosition("DE")).toBe("edge");
    expect(mapEspnPosition("LT")).toBe("ol");
    expect(mapEspnPosition("RB")).toBeUndefined();
    expect(mapEspnStatus("Out")).toBe("out");
    expect(mapEspnStatus("Doubtful")).toBe("doubtful");
    expect(mapEspnStatus("Questionable")).toBe("questionable");
  });

  it("drops stale ESPN rows", () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    expect(espnInjuryIsFresh("2020-11-21T18:31Z", "2026-09-19T16:00:00Z", now)).toBe(false);
    expect(espnInjuryIsFresh("2026-09-17T18:00:00Z", "2026-09-19T16:00:00Z", now)).toBe(true);
  });

  it("does not attach stale ESPN injuries to a current game", () => {
    const items = mapEspnInjuriesToItems({
      game: game(),
      nowMs: Date.parse("2026-09-18T12:00:00Z"),
      payload: {
        injuries: [
          {
            id: "153",
            displayName: "North Carolina Tar Heels",
            injuries: [
              {
                status: "Out",
                date: "2020-11-21T18:31Z",
                athlete: {
                  displayName: "Ghost Receiver",
                  position: { abbreviation: "WR", name: "Wide Receiver" },
                },
              },
            ],
          },
        ],
      },
    });
    expect(items).toEqual([]);
  });
});

describe("operator availability file", () => {
  it("parses reports and binds items to the matching game", () => {
    const reports = parseOperatorAvailabilityFile({
      reports: [
        {
          homeAbbreviation: "CLEM",
          awayAbbreviation: "UNC",
          items: [
            {
              player: "Starter WR",
              teamAbbreviation: "UNC",
              positionGroup: "wr",
              status: "out",
              starter: true,
              snapsLast2: 92,
              replacementQuality: "poor",
              sources: ["official-release", "beat-writer"],
            },
          ],
        },
      ],
    });
    expect(reports).toHaveLength(1);
    const items = itemsFromOperatorReport(reports[0]!, game());
    expect(items[0]?.side).toBe("away");
    expect(items[0]?.player).toBe("Starter WR");
  });

  it("matches operator kickoffDateKey on the Eastern calendar day", async () => {
    const fridayNight: UpcomingGame = {
      ...game(),
      id: "ncaaf:401856811",
      kickoffIso: "2026-09-19T00:00:00Z",
      home: { id: "ncaaf:2641", abbreviation: "TTU", name: "Texas Tech" },
      away: { id: "ncaaf:248", abbreviation: "HOU", name: "Houston" },
    };
    const byGame = await loadNcaafAvailabilityItems([fridayNight], {
      espnPayload: { injuries: [] },
      operatorReports: parseOperatorAvailabilityFile({
        reports: [
          {
            homeAbbreviation: "TTU",
            awayAbbreviation: "HOU",
            kickoffDateKey: "2026-09-18",
            items: [
              {
                player: "Muizz Tounkara",
                teamAbbreviation: "HOU",
                positionGroup: "wr",
                status: "out",
                snapsLast2: 0,
                sources: ["conference-report"],
              },
            ],
          },
        ],
      }),
    });
    expect(byGame.get("ncaaf:401856811")?.map((item) => item.player)).toEqual(["Muizz Tounkara"]);
  });

  it("rejects a side that does not match the team", () => {
    const reports = parseOperatorAvailabilityFile({
      reports: [
        {
          gameId: "ncaaf:401858229",
          items: [
            {
              player: "Wrong",
              teamAbbreviation: "UNC",
              side: "home",
              positionGroup: "wr",
              status: "out",
              sources: ["conference-report"],
            },
          ],
        },
      ],
    });
    expect(() => itemsFromOperatorReport(reports[0]!, game())).toThrow(/does not match/);
  });
});

describe("loadNcaafAvailabilityItems", () => {
  it("merges operator reports over ESPN and skips duplicate names", async () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    const byGame = await loadNcaafAvailabilityItems([game()], {
      nowMs: now,
      operatorReports: parseOperatorAvailabilityFile({
        reports: [
          {
            gameId: "ncaaf:401858229",
            items: [
              {
                player: "Starter WR",
                teamAbbreviation: "UNC",
                positionGroup: "wr",
                status: "out",
                starter: true,
                sources: ["official-release"],
              },
            ],
          },
        ],
      }),
      espnPayload: {
        injuries: [
          {
            id: "153",
            injuries: [
              {
                status: "Out",
                date: "2026-09-17T18:00:00Z",
                athlete: {
                  displayName: "Starter WR",
                  position: { abbreviation: "WR" },
                },
              },
              {
                status: "Out",
                date: "2026-09-17T18:00:00Z",
                athlete: {
                  displayName: "Left Tackle",
                  position: { abbreviation: "LT" },
                },
              },
            ],
          },
        ],
      },
    });
    const items = byGame.get("ncaaf:401858229") ?? [];
    expect(items.map((row) => row.player).sort()).toEqual(["Left Tackle", "Starter WR"]);
    expect(items.find((row) => row.player === "Starter WR")?.sources).toEqual(["official-release"]);
  });
});
