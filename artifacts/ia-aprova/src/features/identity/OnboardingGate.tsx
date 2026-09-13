import { useAuth } from '@clerk/expo';
import { Redirect, useSegments } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/RemoteState';
import { useApi } from '@/src/services/api/ApiProvider';
import { ApiConfigurationError } from '@/src/services/api/types';
import { useOnboardingState } from './api';

export function OnboardingGate({ children }: React.PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth();
  const { client } = useApi();
  const segments = useSegments();
  const rootSegment = String(segments[0] || '');
  // Expo Router's generated type can be a one-item tuple even though nested
  // routes expose a second runtime segment. Read it through a widened view.
  const childSegment = String((segments as readonly string[])[1] || '');
  const stateQuery = useOnboardingState();

  if (!isLoaded) {
    return <GateState><LoadingState label="Protegendo sua sessão..." /></GateState>;
  }

  if (!isSignedIn) {
    if (rootSegment && rootSegment !== '(auth)') return <Redirect href="/(auth)/login" />;
    return <>{children}</>;
  }

  if (!client.configured) {
    return <GateState><ErrorState error={new ApiConfigurationError()} /></GateState>;
  }

  if (stateQuery.isPending) {
    return <GateState><LoadingState label="Verificando sua elegibilidade..." /></GateState>;
  }

  if (stateQuery.isError || !stateQuery.data) {
    return (
      <GateState>
        <ErrorState error={stateQuery.error} onRetry={() => void stateQuery.refetch()} />
      </GateState>
    );
  }

  // Only the reviewed identity and guardian-accept screens may be reached
  // before eligibility is complete. Keeping this allowlist exact prevents a
  // future/legacy route added under either group from silently bypassing the
  // global guard.
  const isIdentityRoute = rootSegment === '(onboarding)' && childSegment === 'identity';
  const isGuardianAcceptRoute = rootSegment === 'guardian' && childSegment === 'accept';
  if (isIdentityRoute || isGuardianAcceptRoute) return <>{children}</>;

  // Existing accounts are sent through the native store-signal step on their
  // next authenticated session. The prompt itself remains an explicit user
  // action on the reviewed onboarding screen.
  if (stateQuery.data.platformAgeSignal.required && stateQuery.data.platformAgeSignal.status === 'missing') {
    return <Redirect href={'/(onboarding)/identity' as any} />;
  }

  if (!stateQuery.data.onboardingComplete) {
    return <Redirect href={'/(onboarding)/identity' as any} />;
  }

  const isSocialRoute = rootSegment === 'duelo'
    || (rootSegment === '(tabs)' && (childSegment === 'duelo' || childSegment === 'ranking'));
  if (isSocialRoute && !stateQuery.data.social.eligible) {
    return <Redirect href="/(tabs)/performance" />;
  }

  if (rootSegment === 'notifications' && !stateQuery.data.notifications.eligible) {
    return <Redirect href="/(tabs)/profile" />;
  }

  if (!rootSegment || rootSegment === '(auth)') return <Redirect href="/(tabs)" />;
  return <>{children}</>;
}

function GateState({ children }: React.PropsWithChildren) {
  return <View style={styles.state}>{children}</View>;
}

const styles = StyleSheet.create({
  state: { flex: 1, backgroundColor: '#F8FAFC', alignItems: 'stretch', justifyContent: 'center' },
});
