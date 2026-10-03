export type NumericSummary = {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p90: number;
};

function percentile(values: number[], q: number): number {
  if (!values.length) throw new Error("values must not be empty");
  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lo = Math.floor(position);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function summarizeNumbers(values: number[]): NumericSummary {
  if (!values.length) throw new Error("values must not be empty");
  if (values.some(value => !Number.isFinite(value))) throw new Error("values must be finite");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
  };
}
