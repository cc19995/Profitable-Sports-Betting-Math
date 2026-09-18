import { assertProbability } from "./odds";
import type { CalibrationBin } from "./types";

export function brierScore(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0 || predictions.length !== outcomes.length) {
    throw new Error("predictions and outcomes must be equal non-empty arrays");
  }
  let sum = 0;
  for (let i = 0; i < predictions.length; i += 1) {
    const p = assertProbability(predictions[i], `predictions[${i}]`);
    const y = outcomes[i];
    if (y !== 0 && y !== 1) {
      throw new Error(`outcomes[${i}] must be 0 or 1`);
    }
    sum += (p - y) * (p - y);
  }
  return sum / predictions.length;
}

export function reliabilityBins(predictions: number[], outcomes: number[], binCount = 10): CalibrationBin[] {
  if (binCount < 2 || binCount > 25) {
    throw new Error("binCount must be in [2, 25]");
  }
  if (predictions.length !== outcomes.length) {
    throw new Error("predictions and outcomes must be the same length");
  }
  const bins: CalibrationBin[] = Array.from({ length: binCount }, (_, i) => ({
    predicted: (i + 0.5) / binCount,
    actual: 0,
    n: 0,
  }));
  for (let i = 0; i < predictions.length; i += 1) {
    const p = assertProbability(predictions[i], `predictions[${i}]`);
    const y = outcomes[i];
    if (y !== 0 && y !== 1) {
      throw new Error(`outcomes[${i}] must be 0 or 1`);
    }
    const idx = Math.min(binCount - 1, Math.floor(p * binCount));
    const bin = bins[idx];
    if (!bin) {
      continue;
    }
    bin.actual += y;
    bin.n += 1;
  }
  return bins.map((bin, i) => ({
    predicted: (i + 0.5) / binCount,
    actual: bin.n > 0 ? bin.actual / bin.n : 0,
    n: bin.n,
  }));
}
