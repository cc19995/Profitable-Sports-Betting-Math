import { assertFiniteNumber } from "./odds";
import type { SmartSignal } from "./rithmm/types";
import type { MarketLines, MatchupDiagnostic, PricedSide } from "./types";

/**
 * Agent A: availability overlay for live NCAAF.
 * Writes into qbHome/qbAway/userHome/userAway. Walk-forward does not use this.
 */
export const AVAILABILITY_POSITIONS = ["qb", "wr", "edge", "ol"] as const;
export type AvailabilityPosition = (typeof AVAILABILITY_POSITIONS)[number];

export const AVAILABILITY_STATUSES = [
  "out",
  "doubtful",
  "questionable",
  "probable",
  "active",
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const AVAILABILITY_SOURCES = [
  "conference-report",
  "official-release",
  "beat-writer",
] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

export const REPLACEMENT_QUALITIES = ["poor", "average", "capable"] as const;
export type ReplacementQuality = (typeof REPLACEMENT_QUALITIES)[number];

export const AVAILABILITY_SIDES = ["home", "away"] as const;
export type AvailabilitySide = (typeof AVAILABILITY_SIDES)[number];

export type AvailabilitySkipReason =
  | "unpriced-position"
  | "insufficient-usage"
  | "status-unpriced"
  | "missing-source"
  | "already-in-tape"
  | "stale";

export const AVAILABILITY_SCALE = {
  qb: { capable: -3, average: -5, poor: -7 },
  wr: { capable: -1, average: -1.75, poor: -2.5 },
  edge: { capable: -1, average: -1.5, poor: -2 },
  ol: { capable: -1, average: -1.5, poor: -2 },
} as const;

export const AVAILABILITY_STATUS_WEIGHT: Record<AvailabilityStatus, number> = {
  out: 1,
  doubtful: 0.5,
  questionable: 0,
  probable: 0,
  active: 0,
};

export const AVAILABILITY_CAPS = {
  defaultAbs: 3,
  startingQbOutAbs: 7,
  minSnapsLast2: { qb: 40, wr: 45, edge: 25, ol: 50 },
} as const;

export type AvailabilityItem = {
  player: string;
  teamAbbreviation: string;
  side: AvailabilitySide;
  positionGroup: AvailabilityPosition;
  status: AvailabilityStatus;
  sources: AvailabilitySource[];
  starter?: boolean;
  snapsLast2?: number;
  replacementQuality?: ReplacementQuality;
};

export type PricedAvailabilityItem = AvailabilityItem & {
  rawPoints: number;
  skipReason?: AvailabilitySkipReason;
};

export type AvailabilityOverlay = {
  items: PricedAvailabilityItem[];
  raw: { qbHome: number; qbAway: number; userHome: number; userAway: number };
  qbHome: number;
  qbAway: number;
  userHome: number;
  userAway: number;
  startingQbOutHome: boolean;
  startingQbOutAway: boolean;
  marketSpreadMoveTowardHome?: number;
  marketTotalMove?: number;
  applied: boolean;
};

export type AvailabilityDeskAction = "keep" | "cut" | "sit-flip";

const POSITION_SET = new Set<string>(AVAILABILITY_POSITIONS);
const STATUS_SET = new Set<string>(AVAILABILITY_STATUSES);
const SOURCE_SET = new Set<string>(AVAILABILITY_SOURCES);
const QUALITY_SET = new Set<string>(REPLACEMENT_QUALITIES);
const SIDE_SET = new Set<string>(AVAILABILITY_SIDES);

function isPosition(value: string): value is AvailabilityPosition {
  return POSITION_SET.has(value);
}

function isStatus(value: string): value is AvailabilityStatus {
  return STATUS_SET.has(value);
}

function isSource(value: string): value is AvailabilitySource {
  return SOURCE_SET.has(value);
}

function isQuality(value: string): value is ReplacementQuality {
  return QUALITY_SET.has(value);
}

function isSide(value: string): value is AvailabilitySide {
  return SIDE_SET.has(value);
}

function roundPts(value: number): number {
  const shifted = value * 100;
  const sign = Math.sign(shifted) || 1;
  return (sign * Math.round(Math.abs(shifted))) / 100;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export function parseAvailabilityItem(raw: unknown): AvailabilityItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("availability item must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const positionGroup = requireNonEmptyString(rec.positionGroup, "positionGroup");
  if (!isPosition(positionGroup)) {
    throw new Error(`positionGroup must be qb, wr, edge, or ol`);
  }
  const status = requireNonEmptyString(rec.status, "status");
  if (!isStatus(status)) {
    throw new Error("status must be out, doubtful, questionable, probable, or active");
  }
  const side = requireNonEmptyString(rec.side, "side");
  if (!isSide(side)) {
    throw new Error("side must be home or away");
  }
  if (!Array.isArray(rec.sources)) {
    throw new Error("sources must be an array");
  }
  const sources = rec.sources.map((src, i) => {
    if (typeof src !== "string" || !isSource(src)) {
      throw new Error(`sources[${i}] must be conference-report, official-release, or beat-writer`);
    }
    return src;
  });
  let snapsLast2: number | undefined;
  if (rec.snapsLast2 !== undefined) {
    snapsLast2 = assertFiniteNumber(rec.snapsLast2, "snapsLast2");
    if (snapsLast2 < 0) {
      throw new Error("snapsLast2 cannot be negative");
    }
  }
  let replacementQuality: ReplacementQuality | undefined;
  if (rec.replacementQuality !== undefined) {
    if (typeof rec.replacementQuality !== "string" || !isQuality(rec.replacementQuality)) {
      throw new Error("replacementQuality must be poor, average, or capable");
    }
    replacementQuality = rec.replacementQuality;
  }
  let starter: boolean | undefined;
  if (rec.starter !== undefined) {
    if (typeof rec.starter !== "boolean") {
      throw new Error("starter must be a boolean");
    }
    starter = rec.starter;
  }
  return {
    player: requireNonEmptyString(rec.player, "player"),
    teamAbbreviation: requireNonEmptyString(rec.teamAbbreviation, "teamAbbreviation"),
    side,
    positionGroup,
    status,
    sources,
    starter,
    snapsLast2,
    replacementQuality,
  };
}

export function usageAllowsPrice(item: AvailabilityItem): boolean {
  if (item.snapsLast2 === 0) {
    return false;
  }
  if (item.starter === true) {
    return true;
  }
  if (item.snapsLast2 === undefined) {
    return false;
  }
  return item.snapsLast2 >= AVAILABILITY_CAPS.minSnapsLast2[item.positionGroup];
}

export function isStartingQbOut(item: AvailabilityItem): boolean {
  if (item.positionGroup !== "qb") {
    return false;
  }
  if (AVAILABILITY_STATUS_WEIGHT[item.status] < 1) {
    return false;
  }
  return usageAllowsPrice(item);
}

export function estimateItemPoints(item: AvailabilityItem): {
  points: number;
  skipReason?: AvailabilitySkipReason;
} {
  if (item.sources.length === 0) {
    return { points: 0, skipReason: "missing-source" };
  }
  const weight = AVAILABILITY_STATUS_WEIGHT[item.status];
  if (weight === 0) {
    return { points: 0, skipReason: "status-unpriced" };
  }
  if (item.snapsLast2 === 0) {
    return { points: 0, skipReason: "already-in-tape" };
  }
  if (!usageAllowsPrice(item)) {
    return { points: 0, skipReason: "insufficient-usage" };
  }
  const quality = item.replacementQuality ?? "average";
  const full = AVAILABILITY_SCALE[item.positionGroup][quality];
  return { points: roundPts(full * weight) };
}

function capTeam(points: number[], capAbs: number): number[] {
  const sum = points.reduce((acc, n) => acc + n, 0);
  const abs = Math.abs(sum);
  if (abs <= capAbs || abs === 0) {
    return points.map(roundPts);
  }
  const scale = capAbs / abs;
  const rounded = points.map((n) => roundPts(n * scale));
  const roundedSum = rounded.reduce((acc, n) => acc + n, 0);
  const target = sum < 0 ? -capAbs : capAbs;
  const drift = roundPts(target - roundedSum);
  if (drift === 0 || rounded.length === 0) {
    return rounded;
  }
  let idx = 0;
  for (let i = 1; i < rounded.length; i++) {
    if (Math.abs(rounded[i] ?? 0) > Math.abs(rounded[idx] ?? 0)) {
      idx = i;
    }
  }
  rounded[idx] = roundPts((rounded[idx] ?? 0) + drift);
  return rounded;
}

export function spreadMoveTowardHome(market: MarketLines | undefined): number | undefined {
  if (market?.homeSpread === undefined || market.openHomeSpread === undefined) {
    return undefined;
  }
  return assertFiniteNumber(market.openHomeSpread, "openHomeSpread") -
    assertFiniteNumber(market.homeSpread, "homeSpread");
}

export function totalMove(market: MarketLines | undefined): number | undefined {
  if (market?.total === undefined || market.openTotal === undefined) {
    return undefined;
  }
  return assertFiniteNumber(market.total, "total") - assertFiniteNumber(market.openTotal, "openTotal");
}

/**
 * Subtract only the portion of the market move that already agrees with the overlay.
 * Never amplify because the market moved the other way.
 */
export function subtractAgreeingMove(overlay: number, marketMove: number): number {
  assertFiniteNumber(overlay, "overlay");
  assertFiniteNumber(marketMove, "marketMove");
  if (overlay === 0) {
    return 0;
  }
  if (overlay < 0 && marketMove < 0) {
    return Math.min(0, overlay - marketMove);
  }
  if (overlay > 0 && marketMove > 0) {
    return Math.max(0, overlay - marketMove);
  }
  return overlay;
}

function clampToInjurySign(raw: number, next: number): number {
  if (raw === 0) {
    return 0;
  }
  if (raw < 0) {
    return Math.min(0, next);
  }
  return Math.max(0, next);
}

function splitTeam(
  rawQb: number,
  rawUser: number,
  nextTeam: number,
): { qb: number; user: number } {
  const raw = rawQb + rawUser;
  if (raw === 0 || nextTeam === 0) {
    return { qb: 0, user: 0 };
  }
  const qbShare = rawQb / raw;
  return {
    qb: roundPts(nextTeam * qbShare),
    user: roundPts(nextTeam * (1 - qbShare)),
  };
}

function applyMarketSubtract(args: {
  qbHome: number;
  qbAway: number;
  userHome: number;
  userAway: number;
  market?: MarketLines;
}): {
  qbHome: number;
  qbAway: number;
  userHome: number;
  userAway: number;
  marketSpreadMoveTowardHome?: number;
  marketTotalMove?: number;
} {
  const rawHome = args.qbHome + args.userHome;
  const rawAway = args.qbAway + args.userAway;
  const rawMargin = rawHome - rawAway;
  const rawTotal = rawHome + rawAway;
  const spreadMove = spreadMoveTowardHome(args.market);
  const totMove = totalMove(args.market);
  const nextMargin =
    spreadMove === undefined ? rawMargin : subtractAgreeingMove(rawMargin, spreadMove);
  const nextTotal = totMove === undefined ? rawTotal : subtractAgreeingMove(rawTotal, totMove);
  const homeUnclamped = (nextTotal + nextMargin) / 2;
  const awayUnclamped = (nextTotal - nextMargin) / 2;
  const nextHome = roundPts(clampToInjurySign(rawHome, homeUnclamped));
  const nextAway = roundPts(clampToInjurySign(rawAway, awayUnclamped));
  const home = splitTeam(args.qbHome, args.userHome, nextHome);
  const away = splitTeam(args.qbAway, args.userAway, nextAway);
  return {
    qbHome: home.qb,
    qbAway: away.qb,
    userHome: home.user,
    userAway: away.user,
    marketSpreadMoveTowardHome: spreadMove,
    marketTotalMove: totMove,
  };
}

export function buildAvailabilityOverlay(args: {
  items: AvailabilityItem[];
  market?: MarketLines;
}): AvailabilityOverlay {
  if (!Array.isArray(args.items)) {
    throw new Error("availability items must be an array");
  }
  const parsed = args.items.map(parseAvailabilityItem);
  const priced: PricedAvailabilityItem[] = parsed.map((item) => {
    const est = estimateItemPoints(item);
    return { ...item, rawPoints: est.points, skipReason: est.skipReason };
  });

  const homePriced = priced.filter((item) => item.side === "home" && item.rawPoints !== 0);
  const awayPriced = priced.filter((item) => item.side === "away" && item.rawPoints !== 0);
  const startingQbOutHome = homePriced.some((item) => isStartingQbOut(item));
  const startingQbOutAway = awayPriced.some((item) => isStartingQbOut(item));
  const homeCap = startingQbOutHome ? AVAILABILITY_CAPS.startingQbOutAbs : AVAILABILITY_CAPS.defaultAbs;
  const awayCap = startingQbOutAway ? AVAILABILITY_CAPS.startingQbOutAbs : AVAILABILITY_CAPS.defaultAbs;
  const homeCapped = capTeam(homePriced.map((item) => item.rawPoints), homeCap);
  const awayCapped = capTeam(awayPriced.map((item) => item.rawPoints), awayCap);

  let qbHome = 0;
  let userHome = 0;
  homePriced.forEach((item, i) => {
    const pts = homeCapped[i] ?? 0;
    if (item.positionGroup === "qb") {
      qbHome += pts;
    } else {
      userHome += pts;
    }
  });
  let qbAway = 0;
  let userAway = 0;
  awayPriced.forEach((item, i) => {
    const pts = awayCapped[i] ?? 0;
    if (item.positionGroup === "qb") {
      qbAway += pts;
    } else {
      userAway += pts;
    }
  });

  const raw = {
    qbHome: roundPts(qbHome),
    qbAway: roundPts(qbAway),
    userHome: roundPts(userHome),
    userAway: roundPts(userAway),
  };
  const afterMarket = applyMarketSubtract({ ...raw, market: args.market });
  const applied =
    afterMarket.qbHome !== 0 ||
    afterMarket.qbAway !== 0 ||
    afterMarket.userHome !== 0 ||
    afterMarket.userAway !== 0;

  return {
    items: priced,
    raw,
    qbHome: afterMarket.qbHome,
    qbAway: afterMarket.qbAway,
    userHome: afterMarket.userHome,
    userAway: afterMarket.userAway,
    startingQbOutHome,
    startingQbOutAway,
    marketSpreadMoveTowardHome: afterMarket.marketSpreadMoveTowardHome,
    marketTotalMove: afterMarket.marketTotalMove,
    applied,
  };
}

export function decideAvailabilityPick(args: {
  basePick: PricedSide | null;
  overlayPick: PricedSide | null;
}): { pick: PricedSide | null; action: AvailabilityDeskAction } {
  const base = args.basePick;
  const overlay = args.overlayPick;
  if (base && overlay && base.betType === overlay.betType && base.side !== overlay.side) {
    return { pick: null, action: "sit-flip" };
  }
  if (base && !overlay) {
    return { pick: null, action: "cut" };
  }
  return { pick: overlay, action: "keep" };
}

function fmtPts(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function itemNote(item: PricedAvailabilityItem): string {
  const usage =
    item.snapsLast2 !== undefined
      ? `${item.snapsLast2} snaps/2g`
      : item.starter
        ? "starter"
        : "usage n/a";
  if (item.skipReason) {
    return `${item.player} ${item.positionGroup} ${item.status} (${usage}, ${item.skipReason})`;
  }
  return `${item.player} ${item.positionGroup} ${item.status} ${fmtPts(item.rawPoints)} (${usage})`;
}

export function availabilityDiagnostics(overlay: AvailabilityOverlay): MatchupDiagnostic[] {
  const homeItems = overlay.items.filter((item) => item.side === "home");
  const awayItems = overlay.items.filter((item) => item.side === "away");
  if (homeItems.length === 0 && awayItems.length === 0) {
    return [];
  }
  const spreadMove = overlay.marketSpreadMoveTowardHome;
  const totMove = overlay.marketTotalMove;
  const marketNote =
    spreadMove === undefined && totMove === undefined
      ? "No open line to subtract."
      : `Open→current subtracted only when it already agrees with the injury (spread ${
          spreadMove === undefined ? "n/a" : fmtPts(spreadMove)
        } toward home, total ${totMove === undefined ? "n/a" : fmtPts(totMove)}).`;
  return [
    {
      key: "availability",
      label: "Agent A availability",
      homeValue: fmtPts(overlay.qbHome + overlay.userHome),
      awayValue: fmtPts(overlay.qbAway + overlay.userAway),
      note: `${homeItems.map(itemNote).join("; ") || "none"} vs ${
        awayItems.map(itemNote).join("; ") || "none"
      }. ${marketNote}`,
      bettingRelevance:
        "Typed injury overlay into qb/user adjustments, capped at 3 pts unless a starting QB is out. Questionable does not auto-price. Sit rather than flip a side.",
    },
  ];
}

export function availabilitySignals(
  overlay: AvailabilityOverlay,
  action: AvailabilityDeskAction,
): SmartSignal[] {
  const signals: SmartSignal[] = [];
  if (overlay.applied) {
    signals.push({
      id: "agent-a-overlay",
      label: "Agent A availability overlay is in the projection (qb/user points).",
      kind: "caution",
    });
  }
  if (action === "sit-flip") {
    signals.push({
      id: "agent-a-sit-flip",
      label: "Agent A sat this pick: the overlay flipped the side. Do not bet the other side from the news.",
      kind: "caution",
    });
  }
  if (action === "cut") {
    signals.push({
      id: "agent-a-cut",
      label: "Agent A cut the original pick after availability. No replacement side posted.",
      kind: "caution",
    });
  }
  return signals;
}
