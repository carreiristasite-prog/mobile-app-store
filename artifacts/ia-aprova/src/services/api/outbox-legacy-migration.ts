import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Former AsyncStorage queues do not have the transactional guarantees of the
 * SQLite store. The only permitted migration is deletion: this module never
 * reads, copies or reconstructs a legacy payload.
 */
const LEGACY_UNSAFE_KEYS = [
  'ia_aprova_api_outbox_v1',
  'ia_aprova_api_outbox_v2',
  'ia_aprova_api_outbox_v3',
] as const;

export async function discardLegacyOutboxQueues(): Promise<void> {
  await AsyncStorage.multiRemove([...LEGACY_UNSAFE_KEYS]);
}
