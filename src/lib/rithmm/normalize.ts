export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(5, Math.min(95, value));
}

export function zToScore(z: number): number {
  return clampScore(50 + 15 * z);
}

export function scoreToZ(score: number): number {
  if (!Number.isFinite(score)) {
    throw new Error("factor score must be finite");
  }
  return (score - 50) / 15;
}

export function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) {
    return { mean: 0, std: 1 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(values.length, 1);
  return { mean, std: Math.sqrt(variance) };
}

export function scoresFromRaw(rawById: Map<string, number>, invert = false): Map<string, number> {
  const values = [...rawById.values()].filter((value) => Number.isFinite(value));
  const { mean, std } = meanStd(values);
  const out = new Map<string, number>();
  for (const [id, raw] of rawById) {
    if (!Number.isFinite(raw)) {
      out.set(id, 50);
      continue;
    }
    const centered = invert ? mean - raw : raw - mean;
    const z = std < 1e-6 ? 0 : centered / std;
    out.set(id, zToScore(z));
  }
  return out;
}

export function weightedMean(parts: Array<{ value: number; weight: number }>): number {
  let num = 0;
  let den = 0;
  for (const part of parts) {
    if (!Number.isFinite(part.value) || !Number.isFinite(part.weight) || part.weight <= 0) {
      continue;
    }
    num += part.value * part.weight;
    den += part.weight;
  }
  return den > 0 ? num / den : 0;
}
