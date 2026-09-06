const AMERICAN_MIN = -100000;
const AMERICAN_MAX = 100000;

export function assertFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

export function assertProbability(value: unknown, name: string): number {
  const n = assertFiniteNumber(value, name);
  if (n < 0 || n > 1) {
    throw new Error(`${name} must be a probability in [0, 1]`);
  }
  return n;
}

export function assertAmericanOdds(value: unknown, name = "odds"): number {
  const n = assertFiniteNumber(value, name);
  if (n === 0 || n === -100) {
    throw new Error(`${name} cannot be 0 or -100`);
  }
  if (n > -100 && n < 100 && n !== 100) {
    if (n > 0 && n < 100) {
      throw new Error(`${name} American plus-odds must be >= +100`);
    }
    if (n < 0 && n > -100) {
      throw new Error(`${name} American minus-odds must be <= -100`);
    }
  }
  if (n < AMERICAN_MIN || n > AMERICAN_MAX) {
    throw new Error(`${name} is outside a plausible American-odds range`);
  }
  return n;
}

/** Sportsbook implied probability S, including juice. */
export function americanToImplied(odds: number): number {
  const o = assertAmericanOdds(odds, "odds");
  if (o < 0) {
    return -o / (-o + 100);
  }
  return 100 / (o + 100);
}

/** Decimal odds = 1 / S. */
export function americanToDecimal(odds: number): number {
  const o = assertAmericanOdds(odds, "odds");
  if (o < 0) {
    return 1 + 100 / -o;
  }
  return 1 + o / 100;
}

export function impliedToAmerican(implied: number): number {
  const s = assertProbability(implied, "implied");
  if (s <= 0 || s >= 1) {
    throw new Error("implied probability must be in (0, 1) to convert to American odds");
  }
  if (s > 0.5) {
    return Math.round(-100 * s / (1 - s));
  }
  return Math.round(100 * (1 - s) / s);
}

/** Return on risk if the bet wins: 1/S - 1. */
export function returnOnRisk(odds: number): number {
  return americanToDecimal(odds) - 1;
}

export function parseAmericanOdds(raw: string | number): number {
  if (typeof raw === "number") {
    return assertAmericanOdds(raw, "odds");
  }
  const trimmed = raw.trim().replace(/^\+/, "");
  if (trimmed.length === 0) {
    throw new Error("odds string is empty");
  }
  const n = Number(trimmed);
  return assertAmericanOdds(n, "odds");
}

export interface TwoWayMarket {
  homeOdds: number;
  awayOdds: number;
}

/**
 * Multiplicative de-vig. S' is the fair probability after removing juice.
 * J = S - S' is the juice attached to that side.
 */
export function devigTwoWay(homeOdds: number, awayOdds: number): {
  homeS: number;
  awayS: number;
  homeFair: number;
  awayFair: number;
  homeJuice: number;
  awayJuice: number;
  overround: number;
} {
  const homeS = americanToImplied(homeOdds);
  const awayS = americanToImplied(awayOdds);
  const overround = homeS + awayS;
  if (overround <= 0) {
    throw new Error("two-way implied probabilities must be positive");
  }
  const homeFair = homeS / overround;
  const awayFair = awayS / overround;
  return {
    homeS,
    awayS,
    homeFair,
    awayFair,
    homeJuice: homeS - homeFair,
    awayJuice: awayS - awayFair,
    overround,
  };
}

export function juiceOnSide(sideOdds: number, oppositeOdds: number): number {
  const market = devigTwoWay(sideOdds, oppositeOdds);
  return market.homeJuice;
}
