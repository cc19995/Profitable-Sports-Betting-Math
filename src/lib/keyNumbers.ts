import { clamp01, normalCdf } from "./normal";
import { assertFiniteNumber } from "./odds";

const NFL_KEY_MARGINS = new Set([3, 7, 6, 10, 14, 4, 8, 1]);

/**
 * Cover probability for the home team vs a market home spread.
 * homeSpread is the home line (SEA -3.5 => -3.5).
 * Extra mass on 3 and 7 is applied as a small discrete correction so we
 * do not treat 2.5 and 3.5 as equally far from a field-goal result.
 */
export function coverProbabilities(args: {
  expectedMargin: number;
  homeSpread: number;
  sigma: number;
  league: "nfl" | "ncaaf";
}): { home: number; away: number; push: number } {
  const mu = assertFiniteNumber(args.expectedMargin, "expectedMargin");
  const line = assertFiniteNumber(args.homeSpread, "homeSpread");
  const sigma = assertFiniteNumber(args.sigma, "sigma");
  if (sigma <= 0) {
    throw new Error("sigma must be positive");
  }

  const coverThreshold = -line;
  const isInteger = Math.abs(line - Math.round(line)) < 1e-9;
  let push = 0;
  let home: number;
  if (isInteger) {
    push = normalCdf(coverThreshold + 0.5, mu, sigma) - normalCdf(coverThreshold - 0.5, mu, sigma);
    home = 1 - normalCdf(coverThreshold + 0.5, mu, sigma);
  } else {
    home = 1 - normalCdf(coverThreshold, mu, sigma);
  }

  if (args.league === "nfl" && NFL_KEY_MARGINS.has(Math.abs(Math.round(line)))) {
    const distanceToThree = Math.abs(Math.abs(line) - 3);
    const distanceToSeven = Math.abs(Math.abs(line) - 7);
    const keyBump = distanceToThree <= 0.5 ? 0.012 : distanceToSeven <= 0.5 ? 0.008 : 0;
    if (line < 0) {
      home = clamp01(home + keyBump);
    } else if (line > 0) {
      home = clamp01(home - keyBump);
    }
  }

  const away = clamp01(1 - home - push);
  return { home: clamp01(home), away, push: clamp01(push) };
}

export function totalProbabilities(args: {
  expectedTotal: number;
  totalLine: number;
  sigma: number;
}): { over: number; under: number; push: number } {
  const mu = assertFiniteNumber(args.expectedTotal, "expectedTotal");
  const line = assertFiniteNumber(args.totalLine, "totalLine");
  const sigma = assertFiniteNumber(args.sigma, "sigma");
  if (sigma <= 0) {
    throw new Error("sigma must be positive");
  }
  const isInteger = Math.abs(line - Math.round(line)) < 1e-9;
  if (isInteger) {
    const push = normalCdf(line + 0.5, mu, sigma) - normalCdf(line - 0.5, mu, sigma);
    const under = normalCdf(line - 0.5, mu, sigma);
    return { over: clamp01(1 - under - push), under: clamp01(under), push: clamp01(push) };
  }
  const under = normalCdf(line, mu, sigma);
  return { over: clamp01(1 - under), under: clamp01(under), push: 0 };
}

export function winProbabilities(args: {
  expectedMargin: number;
  sigma: number;
}): { home: number; away: number } {
  const mu = assertFiniteNumber(args.expectedMargin, "expectedMargin");
  const sigma = assertFiniteNumber(args.sigma, "sigma");
  const away = normalCdf(0, mu, sigma);
  return { home: clamp01(1 - away), away: clamp01(away) };
}

export function keyNumberNote(homeSpread: number | undefined): string | null {
  if (homeSpread === undefined || !Number.isFinite(homeSpread)) {
    return null;
  }
  const abs = Math.abs(homeSpread);
  if (Math.abs(abs - 3) <= 0.5) {
    return "Line is on the 3 key. A field-goal result decides most covers; half-points around 3 are not interchangeable.";
  }
  if (Math.abs(abs - 7) <= 0.5) {
    return "Line is on the 7 key. A touchdown result clusters here; crossing 7 is worth more than a typical 0.5 move.";
  }
  return null;
}
