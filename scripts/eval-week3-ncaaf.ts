/**
 * One-off Week 3 board price for requested markets.
 * Uses the live NCAAF engine (SRS + profit gate). Skips holdout odds attach.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { attachRestDays, dedupeGames, fetchEspnScoreboard, fetchEspnSeason, isCompletedGame } from "@/src/data/espn";
import { loadCfbFactorStore } from "@/src/data/cfbFactors";
import { handicapMatchup, isActionable, isTrustEligible } from "@/src/lib/matchup";
import { fitTeamRatings, NCAAF_IN_SEASON_FIT } from "@/src/lib/ratings";
import { isProfitEligible } from "@/src/lib/profit";
import { alignmentFromGaps } from "@/src/lib/rithmm/signals";
import { totalProbabilities } from "@/src/lib/keyNumbers";
import { getLeagueConstants } from "@/src/lib/league";
import { americanToImplied } from "@/src/lib/odds";
import { expectedValueFromOdds, expectedValuePerBet } from "@/src/lib/ev";
import { normalCdf } from "@/src/lib/normal";
import type { CompletedGame, UpcomingGame } from "@/src/lib/types";

function upcomingOnly(games: Array<CompletedGame | UpcomingGame>): UpcomingGame[] {
  return games.filter((game) => !isCompletedGame(game));
}
function completedOnly(games: Array<CompletedGame | UpcomingGame>): CompletedGame[] {
  return games.filter(isCompletedGame);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function marginBuckets(homeMinusAway: number, sigma: number): Record<string, number> {
  const p = (lo: number, hi: number) => normalCdf(hi, homeMinusAway, sigma) - normalCdf(lo, homeMinusAway, sigma);
  return {
    home1to6: p(0.5, 6.5),
    home7to12: p(6.5, 12.5),
    home13plus: 1 - normalCdf(12.5, homeMinusAway, sigma),
    away1to6: p(-6.5, -0.5),
    away7to12: p(-12.5, -6.5),
    away13plus: normalCdf(-12.5, homeMinusAway, sigma),
  };
}

function firstScoreProb(homeScore: number, awayScore: number, homeDeferRate = 0.68): { home: number; away: number } {
  const pH = clamp(0.20 + 0.50 * (homeScore / 42), 0.16, 0.62);
  const pA = clamp(0.20 + 0.50 * (awayScore / 42), 0.16, 0.62);
  const denom = 1 - (1 - pA) * (1 - pH);
  const awayIfAwayReceives = pA / denom;
  const awayIfHomeReceives = ((1 - pH) * pA) / denom;
  const away = homeDeferRate * awayIfAwayReceives + (1 - homeDeferRate) * awayIfHomeReceives;
  return { home: 1 - away, away };
}

async function main(): Promise<void> {
  const year = 2026;
  console.error("fetching seasons...");
  const [twoYearsAgo, prior, currentSeason, live] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: year - 2, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year: year - 1, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year, maxWeek: 3, includePostseason: false }),
    fetchEspnScoreboard({ league: "ncaaf" }),
  ]);
  const all = attachRestDays(dedupeGames([...twoYearsAgo, ...prior, ...currentSeason, ...live]));
  const completed = completedOnly(all);
  const upcoming = upcomingOnly(all);
  console.error(`completed=${completed.length} upcoming=${upcoming.length}`);
  const defaultRatings = fitTeamRatings(completed, "ncaaf");
  const ratings = fitTeamRatings(completed, "ncaaf", NCAAF_IN_SEASON_FIT);
  const notable = ["CLEM", "TULN", "MISS", "LSU", "FSU", "ALA", "TA&M", "UK", "LOU", "SMU", "AUB", "FLA", "DUKE", "STAN", "SC", "MSST", "UVA", "WVU", "MD", "VT", "NU", "COLO", "UCLA", "PUR", "OU"];
  const defaultByAbbr = new Map(defaultRatings.map((row) => [row.team.abbreviation, row]));
  const liveByAbbr = new Map(ratings.map((row) => [row.team.abbreviation, row]));
  console.log("IDENTITY_SHIFTS");
  for (const abbr of notable) {
    const prior = defaultByAbbr.get(abbr);
    const live = liveByAbbr.get(abbr);
    if (!prior || !live) {
      console.log(`  ${abbr} missing`);
      continue;
    }
    console.log(
      `  ${abbr} net ${prior.net.toFixed(1)} -> ${live.net.toFixed(1)} (d ${(live.net - prior.net).toFixed(1)})  off ${prior.offense.toFixed(1)}->${live.offense.toFixed(1)}  def ${prior.defense.toFixed(1)}->${live.defense.toFixed(1)}`,
    );
  }
  const factorStore = await loadCfbFactorStore([year - 2, year - 1, year]).catch((error: unknown) => {
    console.error("factors unavailable", error instanceof Error ? error.message : error);
    return undefined;
  });

  const targets: Array<{
    away: string;
    home: string;
    market: string;
    homeSpread?: number;
    total?: number;
    teamTotal?: { side: "home" | "away"; line: number };
  }> = [
    { away: "UK", home: "TA&M", market: "spread", homeSpread: -16.5 },
    { away: "FSU", home: "ALA", market: "spread", homeSpread: -19.5 },
    { away: "SMU", home: "LOU", market: "moneyline" },
    { away: "FLA", home: "AUB", market: "margin" },
    { away: "STAN", home: "DUKE", market: "spread", homeSpread: -9.5 },
    { away: "MSST", home: "SC", market: "spread", homeSpread: -3.5 },
    { away: "LSU", home: "MISS", market: "margin", homeSpread: 2.5 },
    { away: "WVU", home: "UVA", market: "spread", homeSpread: -9.5 },
    { away: "VT", home: "MD", market: "spread", homeSpread: 3.5 },
    { away: "COLO", home: "NU", market: "spread", homeSpread: -3.5 },
    { away: "PUR", home: "UCLA", market: "spread", homeSpread: -14.5 },
    { away: "FSU", home: "ALA", market: "score" },
    { away: "UK", home: "TA&M", market: "score" },
    { away: "UNM", home: "OU", market: "score" },
    { away: "PUR", home: "UCLA", market: "score" },
  ];

  const cards = [];
  for (const target of targets) {
    const game = upcoming.find((g) => g.home.abbreviation === target.home && g.away.abbreviation === target.away);
    if (!game) {
      cards.push({ target, error: "not on upcoming board" });
      continue;
    }
    const marketOverride = {
      ...game.market,
      ...(target.homeSpread !== undefined ? { homeSpread: target.homeSpread, homeSpreadOdds: -110, awaySpreadOdds: -110 } : {}),
      ...(target.total !== undefined ? { total: target.total, overOdds: -110, underOdds: -110 } : {}),
    };
    const report = handicapMatchup({
      game,
      ratings,
      factorLookup: factorStore?.lookup,
      priceWithHouse: false,
      marketOverride,
    });
    const extras = {
      confidence: report.confidence.score,
      homeGames: report.ratings.home.games,
      awayGames: report.ratings.away.games,
    };
    const priced = report.priced.map((side) => {
      const alignment = alignmentFromGaps({
        betType: side.betType,
        spreadGap: marketOverride.homeSpread !== undefined ? report.projection.margin + marketOverride.homeSpread : undefined,
        totalGap: marketOverride.total !== undefined ? report.projection.total - marketOverride.total : undefined,
      });
      return {
        ...side,
        alignment,
        actionable: isActionable(side, marketOverride, report.projection.margin, report.projection.total, "ncaaf"),
        trust: isTrustEligible(side, marketOverride, report.projection.margin, report.projection.total, "ncaaf", extras),
        profit: isProfitEligible(side, marketOverride, report.projection.margin, report.projection.total, "ncaaf", extras, alignment),
      };
    });

    const ttSide = target.teamTotal?.side ?? "home";
    const ttModel = ttSide === "home" ? report.projection.homeScore : report.projection.awayScore;
    const ttLine = target.teamTotal?.line ?? (
      marketOverride.total !== undefined && marketOverride.homeSpread !== undefined
        ? (ttSide === "home"
          ? (marketOverride.total - marketOverride.homeSpread) / 2
          : (marketOverride.total + marketOverride.homeSpread) / 2)
        : ttModel
    );
    const homeTt = totalProbabilities({
      expectedTotal: ttModel,
      totalLine: ttLine,
      sigma: getLeagueConstants("ncaaf").totalSigma * 0.72,
    });
    const first = firstScoreProb(report.projection.homeScore, report.projection.awayScore);
    const firstHomeS = americanToImplied(-115);
    const firstAwayS = americanToImplied(-115);

    cards.push({
      target,
      kickoffIso: game.kickoffIso,
      matchup: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
      names: `${game.away.name} @ ${game.home.name}`,
      engine: report.engine,
      market: game.market,
      projection: report.projection,
      ratings: {
        home: {
          abbr: report.ratings.home.team.abbreviation,
          off: report.ratings.home.offense,
          def: report.ratings.home.defense,
          net: report.ratings.home.net,
          games: report.ratings.home.games,
          pf: report.ratings.home.avgPointsFor,
          pa: report.ratings.home.avgPointsAgainst,
          last4: report.ratings.home.last4Residual,
        },
        away: {
          abbr: report.ratings.away.team.abbreviation,
          off: report.ratings.away.offense,
          def: report.ratings.away.defense,
          net: report.ratings.away.net,
          games: report.ratings.away.games,
          pf: report.ratings.away.avgPointsFor,
          pa: report.ratings.away.avgPointsAgainst,
          last4: report.ratings.away.last4Residual,
        },
      },
      confidence: report.confidence,
      spreadGap: marketOverride.homeSpread !== undefined ? report.projection.margin + marketOverride.homeSpread : null,
      totalGap: marketOverride.total !== undefined ? report.projection.total - marketOverride.total : null,
      priced,
      teamTotal: {
        side: ttSide,
        line: ttLine,
        model: ttModel,
        overP: homeTt.over,
        underP: homeTt.under,
        overEv: expectedValueFromOdds(homeTt.over, -110, 1),
        underEv: expectedValueFromOdds(homeTt.under, -110, 1),
      },
      firstToScore: {
        modelHome: first.home,
        modelAway: first.away,
        homeEvAt115: expectedValuePerBet(first.home, firstHomeS, 1),
        awayEvAt115: expectedValuePerBet(first.away, firstAwayS, 1),
      },
      margins: marginBuckets(report.projection.margin, getLeagueConstants("ncaaf").marginSigma),
      factors: report.factors
        ? {
            home: { off: report.factors.home.offense, def: report.factors.home.defense, ranks: report.factors.home.ranks, pace: report.factors.home.pace },
            away: { off: report.factors.away.offense, def: report.factors.away.defense, ranks: report.factors.away.ranks, pace: report.factors.away.pace },
          }
        : null,
    });
  }

  const identityShifts = notable.flatMap((abbr) => {
    const prior = defaultByAbbr.get(abbr);
    const live = liveByAbbr.get(abbr);
    if (!prior || !live) {
      return [];
    }
    return [{
      abbr,
      priorNet: prior.net,
      liveNet: live.net,
      delta: live.net - prior.net,
      priorOff: prior.offense,
      liveOff: live.offense,
      priorDef: prior.defense,
      liveDef: live.defense,
    }];
  });

  const outPath = path.join(process.cwd(), "data", "week3-eval.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), identityShifts, cards }, null, 2));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), n: cards.length, outPath }, null, 2));
  for (const card of cards) {
    if ("error" in card) {
      console.log(`MISSING ${card.target.away} @ ${card.target.home}`);
      continue;
    }
    const p = card.projection;
    console.log(
      `${card.matchup}  model ${p.awayScore.toFixed(1)}-${p.homeScore.toFixed(1)} (m ${p.margin.toFixed(1)} t ${p.total.toFixed(1)})  mkt ${card.market?.details ?? card.market?.homeSpread}/${card.market?.total}  gapS ${card.spreadGap?.toFixed?.(1)} gapT ${card.totalGap?.toFixed?.(1)}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
