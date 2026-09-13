import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { HomeDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { ApiConfigurationError } from '@/src/services/api/types';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function TodayScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client } = useApi();
  const bottomPad = Platform.OS === 'web' ? 96 : insets.bottom + 88;
  const query = useQuery({
    queryKey: ['me', 'home'],
    queryFn: () => client.request<HomeDto>(apiPaths.home),
    enabled: client.configured,
    retry: 1,
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{greeting()}</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Hoje</Text>
          </View>
        </View>

        {!client.configured ? (
          <ErrorState error={new ApiConfigurationError()} />
        ) : query.isLoading ? (
          <LoadingState label="Preparando seu dia..." />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : !query.data ? (
          <EmptyState title="Sem dados de estudo" message="Escolha seu concurso para começar." />
        ) : (
          <TodayContent data={query.data} />
        )}
      </ScrollView>
    </View>
  );
}

function TodayContent({ data }: { data: HomeDto }) {
  const colors = useColors();
  return (
    <>
      <AppCard radius={22} padding={20} style={[styles.hero, { backgroundColor: colors.primary }]}>
        <Text style={styles.heroGreeting}>Seu estudo de hoje</Text>
        <Text style={styles.heroContest}>{data.activeProductId ? 'Concurso ativo' : 'Selecione seu concurso'}</Text>
        <View style={styles.heroMetrics}>
          <View style={styles.metric}>
            <Feather name="clock" size={16} color="#FCD34D" />
            <Text style={styles.metricText}>Meta de {data.dailyGoalMinutes} min</Text>
          </View>
          <View style={styles.metric}>
            <Feather name="zap" size={16} color="#FCD34D" />
            <Text style={styles.metricText}>{data.streak} dias</Text>
          </View>
        </View>
        <Text style={styles.heroTotal}>{data.progress.totalAnswered.toLocaleString('pt-BR')} questões respondidas no total</Text>
      </AppCard>

      <AppCard radius={20} padding={18}>
        <View style={styles.cardHeader}>
          <View style={[styles.cardIcon, { backgroundColor: colors.primaryLight }]}>
            <Feather name="compass" size={19} color={colors.primary} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Próxima atividade</Text>
            <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
              Monte uma sessão adaptativa baseada no concurso ativo e no seu histórico validado.
            </Text>
          </View>
        </View>
        <AppButton
          title="Resolver questões"
          onPress={() => router.push('/(tabs)/questions')}
          fullWidth
          accessibilityHint="Abre a configuração de uma sessão de questões"
        />
      </AppCard>

      <View style={styles.quickRow}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/simulados')}
          style={[styles.quickCard, { backgroundColor: colors.white, borderColor: colors.border }]}
        >
          <Feather name="clipboard" size={21} color={colors.primary} />
          <Text style={[styles.quickTitle, { color: colors.text }]}>Simulados</Text>
          <Text style={[styles.quickBody, { color: colors.textSecondary }]}>Provas cronometradas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/performance')}
          style={[styles.quickCard, { backgroundColor: colors.white, borderColor: colors.border }]}
        >
          <Feather name="bar-chart-2" size={21} color={colors.primary} />
          <Text style={[styles.quickTitle, { color: colors.text }]}>Progresso</Text>
          <Text style={[styles.quickBody, { color: colors.textSecondary }]}>Evolução e Arena</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  headingCopy: { gap: 2 },
  eyebrow: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '900' },
  iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { gap: 12 },
  heroGreeting: { color: 'rgba(255,255,255,0.78)', fontSize: 14, fontWeight: '600' },
  heroContest: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  heroMetrics: { flexDirection: 'row', gap: 18 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  heroTotal: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '600' },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 16 },
  cardIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardBody: { fontSize: 13, lineHeight: 19 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickCard: { flex: 1, padding: 16, borderWidth: 1, borderRadius: 18, gap: 7, minHeight: 128 },
  quickTitle: { fontSize: 15, fontWeight: '800' },
  quickBody: { fontSize: 12, lineHeight: 17 },
});
