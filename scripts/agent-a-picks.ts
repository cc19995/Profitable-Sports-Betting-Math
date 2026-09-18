/**
 * Re-price the nominated Fri/Sat NCAAF picks with Agent A availability overlay.
 */
import { loadNcaafAvailabilityItems } from "@/src/data/availabilityFeed";
import { attachRestDays, dedupeGames, fetchEspnScoreboard, fetchEspnSeason, isCompletedGame } from "@/src/data/espn";
import { loadCfbFactorStore } from "@/src/data/cfbFactors";
import { buildAvailabilityOverlay } from "@/src/lib/availability";
import { priceNcaafGameWithAvailability } from "@/src/lib/availabilityDesk";
import { blendLiveNcaafRatings } from "@/src/lib/ncaafIdentity";
import { handicapMatchup } from "@/src/lib/matchup";
import { alignmentScore, isBestBetEligible, pickQuality, selectTrustedBestBet } from "@/src/lib/picks";
import { kickoffDateKey, kickoffLabel } from "@/src/lib/format";
import type { AvailabilityItem } from "@/src/lib/availability";
import type { BoardRow, CompletedGame, PricedSide, UpcomingGame } from "@/src/lib/types";

function upcomingOnly(games: Array<CompletedGame | UpcomingGame>): UpcomingGame[] {
  return games.filter((game) => !isCompletedGame(game));
}
function completedOnly(games: Array<CompletedGame | UpcomingGame>): CompletedGame[] {
  return games.filter(isCompletedGame);
}

const WEEKEND = new Set(["2026-09-18", "2026-09-19"]);

const NOMINATED: Array<{
  away: string;
  home: string;
  betType: PricedSide["betType"];
  side: PricedSide["side"];
  label: string;
}> = [
  { away: "HOU", home: "TTU", betType: "total", side: "over", label: "Over 52.5" },
  { away: "UNC", home: "CLEM", betType: "spread", side: "away", label: "UNC +3" },
  { away: "PUR", home: "UCLA", betType: "total", side: "over", label: "Over 52.5" },
  { away: "NCSU", home: "VAN", betType: "total", side: "over", label: "Over 50.5" },
  { away: "TEM", home: "TOL", betType: "total", side: "over", label: "Over 49.5" },
  { away: "KENT", home: "OSU", betType: "total", side: "under", label: "Under 59.5" },
  { away: "JMU", home: "SDSU", betType: "total", side: "over", label: "Over 46.5" },
  { away: "CCU", home: "DEL", betType: "spread", side: "away", label: "CCU +5.5" },
];

function sideOnRow(row: BoardRow, betType: PricedSide["betType"], side: PricedSide["side"]): PricedSide | undefined {
  return row.report.priced.find((pick) => pick.betType === betType && pick.side === side);
}

function summarizeSide(row: BoardRow, pick: PricedSide | undefined) {
  if (!pick) {
    return null;
  }
  const spreadGap =
    row.game.market?.homeSpread !== undefined
      ? row.report.projection.margin + row.game.market.homeSpread
      : null;
  const totalGap =
    row.game.market?.total !== undefined ? row.report.projection.total - row.game.market.total : null;
  return {
    label: pick.label,
    odds: pick.americanOdds,
    p: Number(pick.handicappedP.toFixed(4)),
    s: Number(pick.impliedS.toFixed(4)),
    edge: Number(pick.edge.toFixed(4)),
    ev: Number(pick.evPerUnit.toFixed(4)),
    alignment: Number(alignmentScore(row, pick).toFixed(3)),
    eligible: isBestBetEligible(row, pick),
    quality: Number(pickQuality(row, pick).toFixed(3)),
    spreadGap: spreadGap === null ? null : Number(spreadGap.toFixed(2)),
    totalGap: totalGap === null ? null : Number(totalGap.toFixed(2)),
  };
}

async function main(): Promise<void> {
  const year = 2026;
  console.error("fetching board...");
  const [prior, currentSeason, live] = await Promise.all([
    fetchEspnSeason({ league: "ncaaf", year: year - 1, includePostseason: true, maxWeek: 16 }),
    fetchEspnSeason({ league: "ncaaf", year, maxWeek: 3, includePostseason: false }),
    fetchEspnScoreboard({ league: "ncaaf" }),
  ]);
  const all = attachRestDays(dedupeGames([...prior, ...currentSeason, ...live]));
  const completed = completedOnly(all);
  const upcoming = upcomingOnly(all).filter((game) => {
    const key = kickoffDateKey(game.kickoffIso);
    return key !== null && WEEKEND.has(key);
  });
  const ratings = blendLiveNcaafRatings(completed);
  const factorStore = await loadCfbFactorStore([year - 1, year]).catch(() => undefined);
  const availabilityByGame = await loadNcaafAvailabilityItems(upcoming);
  const rated = new Map(ratings.map((row) => [row.team.id, row]));

  const results = [];
  for (const nom of NOMINATED) {
    const game = upcoming.find(
      (row) => row.away.abbreviation === nom.away && row.home.abbreviation === nom.home,
    );
    if (!game) {
      results.push({ matchup: `${nom.away} @ ${nom.home}`, error: "game not on weekend board" });
      continue;
    }
    const home = rated.get(game.home.id);
    const away = rated.get(game.away.id);
    if (!home || !away || home.games < 6 || away.games < 6 || !game.market) {
      results.push({
        matchup: `${nom.away} @ ${nom.home}`,
        error: "not priced (sample or market)",
        homeGames: home?.games,
        awayGames: away?.games,
      });
      continue;
    }
    const items: AvailabilityItem[] = availabilityByGame.get(game.id) ?? [];
    const overlay = buildAvailabilityOverlay({ items, market: game.market });
    const baseReport = handicapMatchup({
      game,
      ratings,
      factorLookup: factorStore?.lookup,
      priceWithHouse: false,
    });
    const baseRow: BoardRow = { game, report: baseReport, bestBet: null };
    baseRow.bestBet = selectTrustedBestBet(baseRow);
    const overlayRow = priceNcaafGameWithAvailability({
      game,
      ratings,
      items,
      factorLookup: factorStore?.lookup,
      priceWithHouse: false,
    });
    const basePick = sideOnRow(baseRow, nom.betType, nom.side);
    const overlayPick = sideOnRow(overlayRow, nom.betType, nom.side);
    let consensus: "keep" | "cut" | "sit-flip" | "still-ineligible" = "keep";
    if (overlayRow.report.signals.some((signal) => signal.id === "agent-a-sit-flip")) {
      consensus = "sit-flip";
    } else if (basePick && isBestBetEligible(baseRow, basePick) && (!overlayPick || !isBestBetEligible(overlayRow, overlayPick))) {
      consensus = "cut";
    } else if (!basePick || !isBestBetEligible(baseRow, basePick)) {
      consensus = overlayPick && isBestBetEligible(overlayRow, overlayPick) ? "keep" : "still-ineligible";
    }
    results.push({
      matchup: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
      names: `${game.away.name} @ ${game.home.name}`,
      kickoff: kickoffLabel(game.kickoffIso),
      nominated: nom.label,
      market: {
        spread: game.market.homeSpread,
        total: game.market.total,
        openSpread: game.market.openHomeSpread,
        openTotal: game.market.openTotal,
        book: game.market.book,
      },
      modelBase: {
        away: Number(baseReport.projection.awayScore.toFixed(2)),
        home: Number(baseReport.projection.homeScore.toFixed(2)),
        margin: Number(baseReport.projection.margin.toFixed(2)),
        total: Number(baseReport.projection.total.toFixed(2)),
      },
      modelOverlay: {
        away: Number(overlayRow.report.projection.awayScore.toFixed(2)),
        home: Number(overlayRow.report.projection.homeScore.toFixed(2)),
        margin: Number(overlayRow.report.projection.margin.toFixed(2)),
        total: Number(overlayRow.report.projection.total.toFixed(2)),
      },
      overlay: {
        qbHome: overlay.qbHome,
        qbAway: overlay.qbAway,
        userHome: overlay.userHome,
        userAway: overlay.userAway,
        applied: overlay.applied,
        startingQbOutAway: overlay.startingQbOutAway,
        startingQbOutHome: overlay.startingQbOutHome,
        spreadMoveTowardHome: overlay.marketSpreadMoveTowardHome,
        totalMove: overlay.marketTotalMove,
        items: overlay.items.map((item) => ({
          player: item.player,
          team: item.teamAbbreviation,
          pos: item.positionGroup,
          status: item.status,
          raw: item.rawPoints,
          skip: item.skipReason ?? null,
        })),
      },
      nominatedBase: summarizeSide(baseRow, basePick),
      nominatedOverlay: summarizeSide(overlayRow, overlayPick),
      deskBestBase: baseRow.bestBet?.label ?? null,
      deskBestOverlay: overlayRow.bestBet?.label ?? null,
      signals: overlayRow.report.signals.map((signal) => signal.id),
      consensus,
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
