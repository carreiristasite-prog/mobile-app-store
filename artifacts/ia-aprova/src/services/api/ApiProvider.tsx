import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { apiPaths } from './paths';
import { ApiClient } from './client';
import { apiOutbox } from './outbox';
import type { OutboxSummary } from './outbox-domain';
import type { ApiNetworkState } from './types';

type ApiContextValue = {
  client: ApiClient;
  networkState: ApiNetworkState;
  pendingSync: number;
  outboxSummary: OutboxSummary | null;
  outboxErrorCode: 'OUTBOX_STORAGE_ERROR' | null;
  syncNow: () => Promise<void>;
};

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children }: React.PropsWithChildren) {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const ownerId = userId ?? null;
  const currentOwnerId = useRef<string | null>(ownerId);
  currentOwnerId.current = ownerId;
  const [cacheOwnerId, setCacheOwnerId] = useState<string | null>(ownerId);
  const [networkState, setNetworkState] = useState<ApiNetworkState>('checking');
  const [pendingSync, setPendingSync] = useState(0);
  const [outboxSummary, setOutboxSummary] = useState<OutboxSummary | null>(null);
  const [outboxErrorCode, setOutboxErrorCode] = useState<'OUTBOX_STORAGE_ERROR' | null>(null);
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;

  const client = useMemo(
    () => new ApiClient(baseUrl, () => getToken(), setNetworkState, ownerId, () => currentOwnerId.current),
    [baseUrl, getToken, ownerId],
  );

  const syncNow = useCallback(async () => {
    if (!client.configured) {
      setNetworkState('unconfigured');
      return;
    }
    try {
      const result = await client.flushOutbox();
      setOutboxSummary(result.summary);
      setPendingSync(result.summary?.pending ?? 0);
      setOutboxErrorCode(null);
      if (result.sent > 0) {
        await queryClient.invalidateQueries();
      }
      if ((result.summary?.pending ?? 0) === 0) setNetworkState('online');
    } catch {
      setOutboxErrorCode('OUTBOX_STORAGE_ERROR');
      setNetworkState('offline');
    }
  }, [client, queryClient]);

  useEffect(() => {
    if (cacheOwnerId !== ownerId) {
      // Block child screens while this happens. Clearing in an effect without
      // the render barrier below can briefly paint the previous user's data.
      queryClient.clear();
      setPendingSync(0);
      setOutboxSummary(null);
      setNetworkState(client.configured ? 'checking' : 'unconfigured');
      let cancelled = false;
      void (async () => {
        try {
          if (cacheOwnerId) await apiOutbox.clearForOwnerId(cacheOwnerId);
          if (!cancelled) setOutboxErrorCode(null);
        } catch {
          // Namespace binding prevents replay under the next account even if
          // the device storage itself refuses the requested purge.
          if (!cancelled) setOutboxErrorCode('OUTBOX_STORAGE_ERROR');
        } finally {
          if (!cancelled) setCacheOwnerId(ownerId);
        }
      })();
      return () => { cancelled = true; };
    }
    return undefined;
  }, [cacheOwnerId, client.configured, ownerId, queryClient]);

  useEffect(() => {
    let cancelled = false;
    if (!client.configured) {
      setNetworkState('unconfigured');
      return;
    }
    void client.outboxSummary().then((summary) => {
      if (!cancelled) {
        setOutboxSummary(summary);
        setPendingSync(summary?.pending ?? 0);
        setOutboxErrorCode(null);
      }
    }).catch(() => {
      if (!cancelled) setOutboxErrorCode('OUTBOX_STORAGE_ERROR');
    });
    client.request(apiPaths.health, { authenticated: false, timeoutMs: 5_000 })
      .then(() => { if (!cancelled) void syncNow(); })
      .catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [client, syncNow]);

  const value = useMemo(
    () => ({ client, networkState, pendingSync, outboxSummary, outboxErrorCode, syncNow }),
    [client, networkState, outboxErrorCode, outboxSummary, pendingSync, syncNow],
  );

  if (cacheOwnerId !== ownerId) {
    return (
      <View accessibilityRole="progressbar" style={styles.identityTransition}>
        <ActivityIndicator color="#1D5DFF" />
        <Text style={styles.identityTransitionText}>Protegendo a troca de conta...</Text>
      </View>
    );
  }

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi deve ser usado dentro de ApiProvider.');
  return value;
}

const styles = StyleSheet.create({
  identityTransition: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#F8FAFC' },
  identityTransitionText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
});
