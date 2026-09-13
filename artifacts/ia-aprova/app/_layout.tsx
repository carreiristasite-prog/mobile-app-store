import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { ClerkProvider, ClerkLoaded } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ApiProvider } from '@/src/services/api/ApiProvider';
import { BillingProvider } from '@/src/services/billing/BillingProvider';
import { OnboardingGate } from '@/src/features/identity/OnboardingGate';

WebBrowser.maybeCompleteAuthSession();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

function RootLayoutNav() {
  return (
    <OnboardingGate>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(onboarding)" options={{ animation: 'none' }} />
        <Stack.Screen name="guardian" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="quiz/index" />
        <Stack.Screen name="simulados/active" />
        <Stack.Screen name="pro/index" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="profile/edit" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings/index" />
      </Stack>
    </OnboardingGate>
  );
}

export default function RootLayout() {
  const [fontsLoadedFromAssets, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // The Sites static runtime may return the SPA fallback for font files.
  // Web can safely use system fallbacks, while native keeps the bundled fonts.
  const fontsLoaded = Platform.OS === 'web' || fontsLoadedFromAssets;

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  if (!publishableKey) {
    return (
      <SafeAreaProvider>
        <View accessibilityRole="alert" style={styles.configError}>
          <Text style={styles.configTitle}>Build não configurado</Text>
          <Text style={styles.configMessage}>
            Defina EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY no perfil de build antes de iniciar o aplicativo.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <ApiProvider>
                    <BillingProvider>
                      <RootLayoutNav />
                    </BillingProvider>
                  </ApiProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  configError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#F8FAFC', gap: 10 },
  configTitle: { color: '#0F172A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  configMessage: { color: '#64748B', fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
