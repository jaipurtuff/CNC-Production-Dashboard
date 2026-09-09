/**
 * Canonical Production Unit: Square Metre Millimetre (m²-mm)
 * 
 * The company's production measurement is NOT ordinary square metres.
 * Formula:
 *   m²-mm = (width_mm / 1000) * (height_mm / 1000) * thickness_mm
 * 
 * Example 1: 1000 x 1000 x 5 mm = 1 x 1 x 5 = 5 m²-mm
 * Example 2: 3660 x 2440 x 5 mm = 3.660 x 2.440 x 5 = 44.652 m²-mm
 * 
 * Internal calculations are NOT rounded prematurely.
 * Display formatting formats with 3 decimal places (XXXX.XXX m²-mm).
 */

export function calculateSqmMm(widthMm: number, heightMm: number, thicknessMm: number): number {
  if (!widthMm || !heightMm || !thicknessMm) return 0;
  return (widthMm / 1000) * (heightMm / 1000) * thicknessMm;
}

export function calculateProductionSqmMm(
  widthMm: number,
  heightMm: number,
  thicknessMm: number,
  count: number = 1
): number {
  return calculateSqmMm(widthMm, heightMm, thicknessMm) * count;
}

export function calculateSqmMmFromArea(areaSqm: number, thicknessMm: number): number {
  if (!areaSqm || !thicknessMm) return 0;
  return areaSqm * thicknessMm;
}

export function formatSqmMm(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '0.000';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
