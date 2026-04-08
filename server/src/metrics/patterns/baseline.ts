// baseline.ts — flat baseline generation layer.
// Returns a constant value for every time point in the axis.

/**
 * Returns a flat array of baselineValue repeated for each time point.
 * The simplest possible layer — the foundation all other layers add to.
 */
export function generateBaseline(
  baselineValue: number,
  tAxis: number[]
): number[] {
  return tAxis.map(() => baselineValue)
}
