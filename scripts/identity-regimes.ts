/**
 * Split 2025-end vs 2026-only SRS so continuity can be diagnosed.
 * Read-only analysis. Does not change live ratings.
 */
import { attachRestDays, dedupeGames, fetchEspnSeason, isCompletedGame } from "@/src/data/espn";
import { blendLiveNcaafRatings, continuityDecision } from "@/src/lib/ncaafIdentity";
import { fitTeamRatings } from "@/src/lib/ratings";
import type { CompletedGame, TeamRating } from "@/src/lib/types";

const NOTABLE = [
  "CLEM", "TULN", "MISS", "LSU", "FSU", "ALA", "TA&M", "UK", "LOU", "SMU",
  "AUB", "FLA", "DUKE", "STAN", "SC", "MSST", "UVA", "WVU", "MD", "VT",
  "NU", "COLO", "UCLA", "PUR", "OU", "UGA", "OSU", "TEX", "ORST", "MICH",
];

function byAbbr(ratings: TeamRating[]): Map<string, TeamRating> {
  return new Map(ratings.map((row) => [row.team.abbreviation, row]));
}

function netOf(map: Map<string, TeamRating>, abbr: string): number | null {
  const row = map.get(abbr);
  return row ? row.net : null;
}

async function main(): Promise<void> {
  const year = 2026;
  const [priorSeason, currentSeason] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: year - 1, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year, maxWeek: 3, includePostseason: false }),
  ]);
  const prior = attachRestDays(dedupeGames(priorSeason)).filter(isCompletedGame) as CompletedGame[];
  const current = attachRestDays(dedupeGames(currentSeason)).filter(isCompletedGame) as CompletedGame[];
  const both = [...prior, ...current];
  console.error(`2025 completed=${prior.length} 2026 completed=${current.length}`);

  const y2025 = byAbbr(fitTeamRatings(prior, "ncaaf"));
  const y2026 = byAbbr(fitTeamRatings(current, "ncaaf"));
  const blended = byAbbr(blendLiveNcaafRatings(both));
  const sticky = byAbbr(fitTeamRatings(both, "ncaaf"));

  const rows = NOTABLE.flatMap((abbr) => {
    const priorNet = netOf(y2025, abbr);
    const nowNet = netOf(y2026, abbr);
    const blendNet = netOf(blended, abbr);
    const stickyNet = netOf(sticky, abbr);
    if (priorNet === null || nowNet === null || blendNet === null || stickyNet === null) {
      return [];
    }
    const decision = continuityDecision({
      abbreviation: abbr,
      season: year,
      priorNet,
      observedNet: nowNet,
    });
    return [{
      abbr,
      n2026: y2026.get(abbr)?.games ?? 0,
      priorNet,
      nowNet,
      delta: nowNet - priorNet,
      blendNet,
      stickyNet,
      lambda: decision.lambda,
      reason: decision.reason,
    }];
  });

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log("abbr n26  2025  2026  dYoy  λ    reason     blend sticky");
  for (const row of rows) {
    console.log(
      `${row.abbr.padEnd(5)} ${String(row.n2026).padStart(3)}  ${row.priorNet.toFixed(1).padStart(5)} ${row.nowNet.toFixed(1).padStart(6)} ${row.delta.toFixed(1).padStart(6)} ${row.lambda.toFixed(2)} ${row.reason.padEnd(10)} ${row.blendNet.toFixed(1).padStart(6)} ${row.stickyNet.toFixed(1).padStart(6)}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
