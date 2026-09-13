import * as AgeRange from 'expo-age-range';
import { Platform } from 'react-native';

import type { PlatformAgeSignalReport } from '@/src/services/api/dtos';
import { normalizeNativeAgeBand, unavailablePlatformReport } from './platform-age-domain';

function numericPlatformVersion(): number {
  const parsed = typeof Platform.Version === 'number'
    ? Platform.Version
    : Number.parseInt(String(Platform.Version), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nativeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

/**
 * Requests a fresh store signal without retaining the raw native response.
 * This module deliberately discards installId, parental-control metadata,
 * exact bounds and significant-change timestamps.
 */
export async function collectPlatformAgeSignal(): Promise<PlatformAgeSignalReport | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  const platform = Platform.OS;
  const version = numericPlatformVersion();
  if ((platform === 'ios' && version < 26) || (platform === 'android' && version < 23)) {
    return unavailablePlatformReport(platform, 'unsupported');
  }

  try {
    if (platform === 'android') {
      const access = await AgeRange.requestAgeSignalsAccessAsync();
      if (access === 'NOT_SHARED') return unavailablePlatformReport(platform, 'not_shared');
      if (access === 'VERIFICATION_REQUIRED') return unavailablePlatformReport(platform, 'verification_required');
      if (access !== 'SHARED') return unavailablePlatformReport(platform, 'error');
    } else {
      try {
        const required = await AgeRange.isEligibleForAgeFeaturesAsync();
        if (required === false) return unavailablePlatformReport(platform, 'not_required');
      } catch {
        // Official guidance treats eligibility errors as unknown and proceeds
        // to the age-range request, which remains fail-closed below.
      }
    }

    const response = await AgeRange.requestAgeRangeAsync({
      threshold1: 13,
      threshold2: 16,
      threshold3: 18,
    });
    const ageBand = normalizeNativeAgeBand({
      lowerBound: response.lowerBound,
      upperBound: response.upperBound,
    });
    return ageBand
      ? { platform, status: 'shared', ageBand }
      : unavailablePlatformReport(platform, 'error');
  } catch (error) {
    const code = nativeErrorCode(error);
    if (code === 'ERR_AGE_RANGE_USER_DECLINED' || code === 'ERR_AGE_RANGE_TASK_CANCELLED') {
      return unavailablePlatformReport(platform, 'not_shared');
    }
    return unavailablePlatformReport(platform, 'error');
  }
}
