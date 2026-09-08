import { scoreToZ } from "./rithmm/normalize";
import type { ProcessCard, TeamFactors } from "./rithmm/types";

const PRESSURE_CAP = 1.4;
const EXPLOSIVE_TOTAL_CAP = 1.6;
const LUCK_CAP = 1.1;
const RZ_CAP = 0.6;

function clamp(value: number, cap: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-cap, Math.min(cap, value));
}

export interface ProcessMatchup {
  homePoints: number;
  awayPoints: number;
  totalPoints: number;
  pressure: number;
  explosiveTotal: number;
  luckHome: number;
  luckAway: number;
  notes: string[];
}

function card(factors: TeamFactors | undefined): ProcessCard | undefined {
  return factors?.process;
}

/**
 * Principle-driven process matchup. Caps are small on purpose: these
 * rates already leak into EPA. We only add the pieces EPA underweights
 * (pressure differential, explosive environment, fumble-luck fade).
 */
export function processMatchupAdjustment(
  home: TeamFactors | undefined,
  away: TeamFactors | undefined,
): ProcessMatchup {
  const empty: ProcessMatchup = {
    homePoints: 0,
    awayPoints: 0,
    totalPoints: 0,
    pressure: 0,
    explosiveTotal: 0,
    luckHome: 0,
    luckAway: 0,
    notes: [],
  };
  const h = card(home);
  const a = card(away);
  if (!h || !a) {
    return empty;
  }

  const pressure =
    (scoreToZ(h.passRush) - scoreToZ(a.protection) - (scoreToZ(a.passRush) - scoreToZ(h.protection))) * 0.55;
  const pressurePts = clamp(pressure, PRESSURE_CAP);

  const explosiveEnv =
    (scoreToZ(h.explosiveOff) + scoreToZ(a.explosiveOff) - scoreToZ(h.explosiveDef) - scoreToZ(a.explosiveDef)) *
    0.35;
  const explosiveTotal = clamp(explosiveEnv, EXPLOSIVE_TOTAL_CAP);

  const luckFade = (luck: number): number => {
    if (luck >= 62) {
      return -0.7 - 0.02 * (luck - 62);
    }
    if (luck <= 38) {
      return 0.45;
    }
    return 0;
  };
  const luckHome = clamp(luckFade(h.turnoverLuck), LUCK_CAP);
  const luckAway = clamp(luckFade(a.turnoverLuck), LUCK_CAP);

  const rzHome = h.redZoneOff - h.successOff >= 18 ? -RZ_CAP : h.redZoneOff - h.successOff <= -18 ? RZ_CAP * 0.5 : 0;
  const rzAway = a.redZoneOff - a.successOff >= 18 ? -RZ_CAP : a.redZoneOff - a.successOff <= -18 ? RZ_CAP * 0.5 : 0;

  const notes: string[] = [];
  if (Math.abs(pressurePts) >= 0.45) {
    notes.push(
      pressurePts > 0
        ? "Home pass rush / protection mismatch"
        : "Away pass rush / protection mismatch",
    );
  }
  if (Math.abs(explosiveTotal) >= 0.7) {
    notes.push(explosiveTotal > 0 ? "Both sides live in an explosive-play environment" : "Suppressed explosives");
  }
  if (luckHome <= -0.45) {
    notes.push("Home fumble/turnover luck likely to regress");
  }
  if (luckAway <= -0.45) {
    notes.push("Away fumble/turnover luck likely to regress");
  }
  if (rzHome !== 0 || rzAway !== 0) {
    notes.push("Red-zone finishing diverges from down-to-down success — faded toward the mean");
  }

  return {
    homePoints: Number((pressurePts / 2 + luckHome + rzHome).toFixed(3)),
    awayPoints: Number((-pressurePts / 2 + luckAway + rzAway).toFixed(3)),
    totalPoints: Number(explosiveTotal.toFixed(3)),
    pressure: Number(pressurePts.toFixed(3)),
    explosiveTotal: Number(explosiveTotal.toFixed(3)),
    luckHome,
    luckAway,
    notes,
  };
}

export function pythagoreanWins(pointsFor: number, pointsAgainst: number, games: number, exponent = 2.37): number {
  if (!Number.isFinite(pointsFor) || !Number.isFinite(pointsAgainst) || !Number.isFinite(games)) {
    throw new Error("pythagorean inputs must be finite");
  }
  if (games <= 0 || pointsFor <= 0 || pointsAgainst <= 0) {
    return 0;
  }
  return games / (1 + (pointsAgainst / pointsFor) ** exponent);
}

const PACIFIC = new Set(["SEA", "SF", "LAR", "LA", "LAC", "ARI"]);

export function processCard(partial: Partial<ProcessCard> = {}): ProcessCard {
  return {
    successOff: 50,
    successDef: 50,
    explosiveOff: 50,
    explosiveDef: 50,
    protection: 50,
    passRush: 50,
    turnoverLuck: 50,
    redZoneOff: 50,
    redZoneDef: 50,
    thirdDownOff: 50,
    thirdDownDef: 50,
    passRate: 50,
    ...partial,
  };
}

/**
 * Early Eastern window only (about 12–2 PM ET / 16–18 UTC).
 * Thursday/Sunday night kickoffs are 00:xx UTC and must not fire this.
 */
export function westCoastEarlyPenalty(args: {
  league: string;
  awayAbbr: string;
  kickoffIso: string;
  neutralSite?: boolean;
}): number {
  if (args.league !== "nfl" || args.neutralSite) {
    return 0;
  }
  if (!PACIFIC.has(args.awayAbbr.toUpperCase())) {
    return 0;
  }
  const ts = Date.parse(args.kickoffIso);
  if (!Number.isFinite(ts)) {
    return 0;
  }
  const hourUtc = new Date(ts).getUTCHours();
  if (hourUtc >= 16 && hourUtc < 17) {
    return -1;
  }
  if (hourUtc >= 17 && hourUtc <= 18) {
    return -0.7;
  }
  return 0;
}
