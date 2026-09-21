/** Round to 2 decimals the way currency should behave (half-up on positives). */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Round to 4 decimals — the precision of every quantity column. */
export function qty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/** Difference within the tolerance of a 2-decimal money column. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}
