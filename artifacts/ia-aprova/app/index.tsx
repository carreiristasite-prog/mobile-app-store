import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const INTRO_KEY = 'ia_aprova_onboarding_done';

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(INTRO_KEY)
      .then((value) => { if (!cancelled) setIntroSeen(value === 'true'); })
      .catch(() => { if (!cancelled) setIntroSeen(false); });
    return () => { cancelled = true; };
  }, []);

  if (!isLoaded || (!isSignedIn && introSeen === null)) {
    return <View accessibilityRole="progressbar" style={styles.loading}><ActivityIndicator color="#1D5DFF" /><Text style={styles.loadingText}>Abrindo IA Aprova...</Text></View>;
  }
  if (isSignedIn) {
    return <Redirect href="/(tabs)" />;
  }
  return <Redirect href={introSeen ? '/(auth)/login' : '/(auth)/splash'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#F8FAFC' },
  loadingText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
});
