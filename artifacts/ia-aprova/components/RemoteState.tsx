import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import AppButton from './AppButton';
import { toUserMessage } from '@/src/services/api/types';

export function LoadingState({ label = 'Carregando...' }: { label?: string }) {
  const colors = useColors();
  return (
    <View accessibilityRole="progressbar" style={styles.container}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.message, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View accessibilityRole="alert" style={styles.container}>
      <Feather name="alert-circle" size={28} color={colors.error} />
      <Text style={[styles.title, { color: colors.text }]}>Não foi possível carregar</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{toUserMessage(error)}</Text>
      {onRetry ? <AppButton title="Tentar novamente" onPress={onRetry} size="sm" variant="outline" /> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Feather name="inbox" size={28} color={colors.textLight} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
