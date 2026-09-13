import { useAuth } from '@clerk/expo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import type { BillingIdentityDto, EntitlementDto } from '../api/dtos';
import { apiPaths } from '../api/paths';
import { ApiConfigurationError } from '../api/types';
import {
  getMonthlyOffering,
  purchaseMonthly as purchaseMonthlyNative,
  restorePurchases,
  resetPurchasesCache,
  syncPurchasesIdentity,
} from './purchases';
import type { MonthlyOffering } from './purchases.types';

export const MONTHLY_PRODUCT_ID = Platform.OS === 'android'
  ? 'iaaprova.pro.monthly:monthly-auto-renewing' as const
  : 'iaaprova.pro.monthly' as const;

export type BillingSubmission = 'submitted' | 'pending_validation';

type BillingContextValue = {
  entitlement: EntitlementDto | undefined;
  offering: MonthlyOffering | null;
  loading: boolean;
  error: unknown;
  nativePurchasesAvailable: boolean;
  refresh: () => Promise<void>;
  purchaseMonthly: () => Promise<BillingSubmission>;
  restore: () => Promise<BillingSubmission>;
};

const BillingContext = createContext<BillingContextValue | null>(null);

/**
 * RevenueCat initiates and restores store transactions. It never unlocks Pro
 * locally: every action requests backend reconciliation and the UI consumes
 * only GET /billing/entitlement.
 */
export function BillingProvider({ children }: React.PropsWithChildren) {
  const { client } = useApi();
  const { isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const [offering, setOffering] = useState<MonthlyOffering | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkLoading, setSdkLoading] = useState(true);
  const [sdkError, setSdkError] = useState<unknown>(null);
  const [sdkRetryNonce, setSdkRetryNonce] = useState(0);

  const queryKey = useMemo(() => ['billing', 'entitlement', userId] as const, [userId]);
  const query = useQuery({
    queryKey,
    queryFn: () => client.request<EntitlementDto>(apiPaths.entitlement),
    enabled: Boolean(client.configured && isSignedIn),
    retry: 1,
    staleTime: 30_000,
    refetchInterval: isSignedIn ? 30_000 : false,
  });
  const identityQuery = useQuery({
    queryKey: ['billing', 'identity', userId] as const,
    queryFn: () => client.request<BillingIdentityDto>(apiPaths.billingIdentity),
    enabled: Boolean(client.configured && isSignedIn),
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    let cancelled = false;
    setSdkLoading(true);
    setSdkError(null);
    setOffering(null);

    const synchronize = async () => {
      try {
        const appUserId = isSignedIn ? identityQuery.data?.appUserId ?? null : null;
        if (isSignedIn && !appUserId) {
          if (!cancelled) setSdkReady(false);
          return;
        }
        resetPurchasesCache();
        const ready = await syncPurchasesIdentity(appUserId);
        const nextOffering = ready && appUserId ? await getMonthlyOffering(appUserId) : null;
        if (cancelled) return;
        setSdkReady(ready);
        setOffering(nextOffering);
      } catch (error) {
        if (!cancelled) {
          setSdkReady(false);
          setSdkError(error);
        }
      } finally {
        if (!cancelled) setSdkLoading(false);
      }
    };

    void synchronize();
    return () => { cancelled = true; };
  }, [identityQuery.data?.appUserId, isSignedIn, sdkRetryNonce]);

  const refresh = useCallback(async () => {
    resetPurchasesCache();
    setSdkRetryNonce((value) => value + 1);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['billing', 'identity', userId] }),
    ]);
  }, [queryClient, queryKey, userId]);

  const reconcileWithServer = useCallback(async () => {
    if (!userId) throw new Error('Entre na sua conta antes de gerenciar uma assinatura.');
    await client.mutate(apiPaths.billingRestore, {
      method: 'POST',
      body: {},
      queueWhenOffline: false,
    });
    await refresh();
  }, [client, refresh, userId]);

  const purchaseMonthly = useCallback(async () => {
    if (!sdkReady || !offering?.available) {
      throw new Error('O plano mensal não está disponível neste build.');
    }
    const appUserId = identityQuery.data?.appUserId;
    if (!appUserId) throw new Error('A identidade de cobrança ainda não está disponível.');
    await purchaseMonthlyNative(appUserId);
    try {
      await reconcileWithServer();
      return 'submitted' as const;
    } catch {
      void queryClient.invalidateQueries({ queryKey });
      return 'pending_validation' as const;
    }
  }, [identityQuery.data?.appUserId, offering?.available, queryClient, queryKey, reconcileWithServer, sdkReady]);

  const restore = useCallback(async () => {
    if (!sdkReady) throw new Error('As compras não estão configuradas neste build.');
    const appUserId = identityQuery.data?.appUserId;
    if (!appUserId) throw new Error('A identidade de cobrança ainda não está disponível.');
    await restorePurchases(appUserId);
    try {
      await reconcileWithServer();
      return 'submitted' as const;
    } catch {
      void queryClient.invalidateQueries({ queryKey });
      return 'pending_validation' as const;
    }
  }, [identityQuery.data?.appUserId, queryClient, queryKey, reconcileWithServer, sdkReady]);

  const billingError = !client.configured && isSignedIn
    ? new ApiConfigurationError()
    : query.error ?? identityQuery.error ?? sdkError;

  const value = useMemo<BillingContextValue>(() => ({
    entitlement: query.data,
    offering,
    loading: query.isLoading || identityQuery.isLoading || sdkLoading,
    error: billingError,
    nativePurchasesAvailable: Boolean(sdkReady && isSignedIn),
    refresh,
    purchaseMonthly,
    restore,
  }), [
    billingError,
    isSignedIn,
    offering,
    purchaseMonthly,
    query.data,
    query.isLoading,
    refresh,
    restore,
    sdkLoading,
    sdkReady,
  ]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  const value = useContext(BillingContext);
  if (!value) throw new Error('useBilling deve ser usado dentro de BillingProvider.');
  return value;
}
