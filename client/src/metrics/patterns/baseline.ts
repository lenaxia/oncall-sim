export function generateBaseline(
  baselineValue: number,
  tAxis: number[],
): number[] {
  return tAxis.map(() => baselineValue);
}
