export const MIN_DIMENSION = 1;
export const MAX_DIMENSION = 262144;

export function clampDimension(value: number): number {
  return Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, Math.round(value)));
}

export function parseDimension(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const dimension = Number(normalized);
  if (!Number.isSafeInteger(dimension)) return null;
  if (dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) return null;
  return dimension;
}

export function scrubDimension(startValue: number, horizontalDistance: number): number {
  return clampDimension(startValue + horizontalDistance);
}

export function stepDimension(value: number, direction: -1 | 1): number {
  return clampDimension(value + direction);
}
