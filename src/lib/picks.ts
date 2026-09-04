import { evaluateParlay, parlayAmericanOdds } from "./parlay";
import { kickoffDateKey, kickoffDateLabel } from "./format";
import { isActionable } from "./matchup";
import type { BoardRow, League, PricedSide } from "./types";

export type RankedPick = {
  gameId: string;
  league: League;
  kickoffIso: string;
  dateKey: string;
  dateLabel: string;
  matchup: string;
  awayName: string;
  homeName: string;
  confidence: number;
  homeGames: number;
  awayGames: number;
  modelMargin: number;
  marketSpread: number | undefined;
  modelTotal: number;
  marketTotal: number | undefined;
  pick: PricedSide;
  quality: number;
};

export type RankedCombo = {
  id: string;
  legs: RankedPick[];
  dateKeys: string[];
  sameDate: boolean;
  combinedAmerican: number;
  modelProb: number;
  impliedProb: number;
  evPerUnit: number;
  plusEv: boolean;
  compounds: boolean;
  kellyQuarter: number;
  quality: number;
  warning?: string;
};

const MAX_EV_SINGLE = 0.8;
const MAX_EV_PARLAY = 1.4;
const MIN_EDGE = 0.025;
const MIN_CONFIDENCE = 40;
const MIN_GAMES = 3;

function evSanity(evPerUnit: number): number {
  const evPct = evPerUnit * 100;
  if (evPct <= 22) return 1;
  if (evPct <= 40) return 0.72;
  if (evPct <= 70) return 0.28;
  return 0.06;
}

function spreadGap(row: BoardRow): number | undefined {
  const marketSpread = row.game.market?.homeSpread;
  if (marketSpread === undefined) return undefined;
  return row.report.projection.margin + marketSpread;
}

function totalGap(row: BoardRow): number | undefined {
  const marketTotal = row.game.market?.total;
  if (marketTotal === undefined) return undefined;
  return row.report.projection.total - marketTotal;
}

function alignmentScore(row: BoardRow, pick: PricedSide): number {
  if (pick.betType === "total") {
    const gap = totalGap(row);
    if (gap === undefined) return 0.55;
    const abs = Math.abs(gap);
    if (abs <= 4) return 1;
    if (abs <= 8) return 0.8;
    if (abs <= 12) return 0.42;
    return 0.15;
  }
  const gap = spreadGap(row);
  if (gap === undefined) return 0.5;
  const abs = Math.abs(gap);
  if (pick.betType === "spread") {
    if (abs <= 3.5) return 1;
    if (abs <= 7) return 0.82;
    if (abs <= 11) return 0.4;
    return 0.12;
  }
  if (abs <= 4) return 0.95;
  if (abs <= 8) return 0.7;
  return 0.18;
}

export function isBestBetEligible(row: BoardRow, pick: PricedSide): boolean {
  if (
    !isActionable(
      pick,
      row.game.market,
      row.report.projection.margin,
      row.report.projection.total,
      row.game.league,
    )
  ) {
    return false;
  }
  if (pick.edge < MIN_EDGE) return false;
  if (pick.evPerUnit > MAX_EV_SINGLE) return false;
  if (row.report.confidence.score < MIN_CONFIDENCE) return false;
  if (row.report.ratings.home.games < MIN_GAMES || row.report.ratings.away.games < MIN_GAMES) {
    return false;
  }
  if (
    row.game.league === "ncaaf" &&
    pick.betType === "moneyline" &&
    Math.abs(row.game.market?.homeSpread ?? 0) >= 10
  ) {
    return false;
  }
  return true;
}

export function pickQuality(row: BoardRow, pick: PricedSide): number {
  const sample = (row.report.ratings.home.games + row.report.ratings.away.games) / 2;
  return (
    pick.edge *
    100 *
    (row.report.confidence.score / 100) *
    Math.log1p(sample) *
    evSanity(pick.evPerUnit) *
    alignmentScore(row, pick)
  );
}

function toRankedPick(row: BoardRow, pick: PricedSide): RankedPick {
  return {
    gameId: row.game.id,
    league: row.game.league,
    kickoffIso: row.game.kickoffIso,
    dateKey: kickoffDateKey(row.game.kickoffIso) ?? "",
    dateLabel: kickoffDateLabel(row.game.kickoffIso),
    matchup: `${row.game.away.abbreviation} @ ${row.game.home.abbreviation}`,
    awayName: row.game.away.name,
    homeName: row.game.home.name,
    confidence: row.report.confidence.score,
    homeGames: row.report.ratings.home.games,
    awayGames: row.report.ratings.away.games,
    modelMargin: row.report.projection.margin,
    marketSpread: row.game.market?.homeSpread,
    modelTotal: row.report.projection.total,
    marketTotal: row.game.market?.total,
    pick,
    quality: pickQuality(row, pick),
  };
}

export function collectEligiblePicks(rows: BoardRow[]): RankedPick[] {
  const out: RankedPick[] = [];
  for (const row of rows) {
    for (const pick of row.report.priced) {
      if (isBestBetEligible(row, pick)) {
        out.push(toRankedPick(row, pick));
      }
    }
  }
  return out.sort((a, b) => b.quality - a.quality);
}

export function bestBetsFromPicks(picks: RankedPick[], limit = 12): RankedPick[] {
  const seen = new Set<string>();
  const out: RankedPick[] = [];
  for (const pick of picks) {
    if (seen.has(pick.gameId)) continue;
    seen.add(pick.gameId);
    out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}

export function collectBestBets(rows: BoardRow[], limit = 12): RankedPick[] {
  return bestBetsFromPicks(collectEligiblePicks(rows), limit);
}

function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      const next = items[i];
      if (!next) continue;
      acc.push(next);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function comboQuality(picks: RankedPick[], evPerUnit: number): number {
  const meanConf =
    picks.reduce((sum, pick) => sum + pick.confidence, 0) / Math.max(picks.length, 1);
  const meanPickQ =
    picks.reduce((sum, pick) => sum + pick.quality, 0) / Math.max(picks.length, 1);
  return evPerUnit * 100 * (meanConf / 100) * evSanity(evPerUnit) * Math.log1p(meanPickQ);
}

export function buildParlayCombos(
  picks: RankedPick[],
  options?: { maxPool?: number; maxCombos?: number; sameDateOnly?: boolean },
): RankedCombo[] {
  const maxPool = options?.maxPool ?? 8;
  const maxCombos = options?.maxCombos ?? 12;
  const sameDateOnly = options?.sameDateOnly ?? true;
  const pool = picks.slice(0, maxPool);
  const combos: RankedCombo[] = [];

  for (const size of [2, 3] as const) {
    if (pool.length < size) continue;
    for (const legs of combinations(pool, size)) {
      const gameIds = new Set(legs.map((leg) => leg.gameId));
      if (gameIds.size !== legs.length) continue;
      const dateKeys = [...new Set(legs.map((leg) => leg.dateKey).filter((key) => key.length > 0))];
      if (sameDateOnly && dateKeys.length !== 1) continue;
      const result = evaluateParlay(
        legs.map((leg) => ({
          p: leg.pick.handicappedP,
          americanOdds: leg.pick.americanOdds,
          label: `${leg.matchup} ${leg.pick.label}`,
        })),
      );
      if (!result.plusEv) continue;
      if (result.evPerUnit > MAX_EV_PARLAY) continue;
      combos.push({
        id: legs.map((leg) => `${leg.gameId}:${leg.pick.betType}:${leg.pick.side}`).join("|"),
        legs,
        dateKeys,
        sameDate: dateKeys.length === 1,
        combinedAmerican: parlayAmericanOdds(legs.map((leg) => leg.pick.americanOdds)),
        modelProb: result.p,
        impliedProb: result.s,
        evPerUnit: result.evPerUnit,
        plusEv: result.plusEv,
        compounds: result.compounds,
        kellyQuarter: result.kellyQuarter,
        quality: comboQuality(legs, result.evPerUnit),
        warning: result.warning,
      });
    }
  }

  return combos.sort((a, b) => b.quality - a.quality).slice(0, maxCombos);
}

export function collectParlayCombos(
  rows: BoardRow[],
  options?: { maxPool?: number; maxCombos?: number; sameDateOnly?: boolean },
): RankedCombo[] {
  const bets = collectBestBets(rows, options?.maxPool ?? 10);
  return buildParlayCombos(bets, options);
}

export function filterBoardByDate(rows: BoardRow[], dateKey: string | null | undefined): BoardRow[] {
  if (!dateKey || dateKey === "all") {
    return rows;
  }
  return rows.filter((row) => kickoffDateKey(row.game.kickoffIso) === dateKey);
}
