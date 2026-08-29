export interface NumericControlOptions {
  integer?: boolean;
  maximum?: number;
  minimum?: number;
  scrubStep?: number;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const exponentIndex = text.indexOf('e-');
  if (exponentIndex >= 0) return Number(text.slice(exponentIndex + 2));
  const decimalIndex = text.indexOf('.');
  return decimalIndex < 0 ? 0 : text.length - decimalIndex - 1;
}

export function numericScrubStep(options: NumericControlOptions): number {
  if (options.integer === true) return 1;
  if (options.scrubStep !== undefined && options.scrubStep > 0) return options.scrubStep;
  if (options.minimum !== undefined && options.maximum !== undefined) {
    const range = options.maximum - options.minimum;
    if (range <= 2) return 0.01;
    if (range <= 40) return 0.1;
  }
  return 1;
}

export function clampNumericValue(value: number, options: NumericControlOptions): number {
  const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
  const maximum = options.maximum ?? Number.POSITIVE_INFINITY;
  return Math.max(minimum, Math.min(maximum, value));
}

export function parseNumericInput(value: string, options: NumericControlOptions): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (options.integer === true && !Number.isSafeInteger(parsed)) return null;
  if (options.minimum !== undefined && parsed < options.minimum) return null;
  if (options.maximum !== undefined && parsed > options.maximum) return null;
  return parsed;
}

export function scrubNumericValue(
  startValue: number,
  horizontalDistance: number,
  options: NumericControlOptions,
  fine = false,
): number {
  const step = numericScrubStep(options) * (fine ? 0.1 : 1);
  const precision = decimalPlaces(step);
  const value = startValue + horizontalDistance * step;
  const rounded = options.integer === true ? Math.round(value) : Number(value.toFixed(precision));
  return clampNumericValue(rounded, options);
}
