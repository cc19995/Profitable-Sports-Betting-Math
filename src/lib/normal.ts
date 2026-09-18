import { assertFiniteNumber } from "./odds";

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function standardNormalCdf(z: number): number {
  const x = assertFiniteNumber(z, "z");
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normalCdf(x: number, mean: number, sigma: number): number {
  const xx = assertFiniteNumber(x, "x");
  const mu = assertFiniteNumber(mean, "mean");
  const sd = assertFiniteNumber(sigma, "sigma");
  if (sd <= 0) {
    throw new Error("sigma must be positive");
  }
  return standardNormalCdf((xx - mu) / sd);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("value must be finite");
  }
  return Math.min(1, Math.max(0, value));
}
