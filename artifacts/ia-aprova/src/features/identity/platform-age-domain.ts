import type { AgeBand, PlatformAgeSignalReport } from '@/src/services/api/dtos';

export type MinimalNativeAgeRange = {
  lowerBound: number | null;
  upperBound: number | null;
};

/**
 * Converts native inclusive bounds to the only four ranges used by the
 * product. Ambiguous or overlapping bounds are rejected instead of guessed.
 */
export function normalizeNativeAgeBand(range: MinimalNativeAgeRange): AgeBand | null {
  const { lowerBound, upperBound } = range;
  if (lowerBound !== null && (!Number.isInteger(lowerBound) || lowerBound < 0 || lowerBound > 130)) return null;
  if (upperBound !== null && (!Number.isInteger(upperBound) || upperBound < 0 || upperBound > 130)) return null;
  if (lowerBound !== null && upperBound !== null && lowerBound > upperBound) return null;
  if (upperBound !== null && upperBound <= 12) return 'under_13';
  if (lowerBound !== null && lowerBound >= 18) return '18_plus';
  if (lowerBound !== null && upperBound !== null && lowerBound >= 13 && upperBound <= 15) return '13_15';
  if (lowerBound !== null && upperBound !== null && lowerBound >= 16 && upperBound <= 17) return '16_17';
  return null;
}

export function unavailablePlatformReport(
  platform: PlatformAgeSignalReport['platform'],
  status: Exclude<PlatformAgeSignalReport['status'], 'shared'>,
): PlatformAgeSignalReport {
  return { platform, status, ageBand: null };
}
