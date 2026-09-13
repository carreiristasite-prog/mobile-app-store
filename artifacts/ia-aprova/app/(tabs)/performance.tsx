import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppCard from '@/components/AppCard';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { ProgressDto, SocialSummaryDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { ApiConfigurationError } from '@/src/services/api/types';

export default function ProgressScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client } = useApi();
  const progress = useQuery({ queryKey: ['me', 'progress'], queryFn: () => client.request<ProgressDto>(apiPaths.progress), enabled: client.configured, retry: 1 });
  const social = useQuery({ queryKey: ['social', 'summary'], queryFn: () => client.request<SocialSummaryDto>(apiPaths.socialSummary), enabled: client.configured, retry: 1 });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 96 : insets.bottom + 88 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Progresso</Text>
        {!client.configured ? <ErrorState error={new ApiConfigurationError()} />
          : progress.isLoading ? <LoadingState label="Calculando seu progresso..." />
            : progress.error ? <ErrorState error={progress.error} onRetry={() => void progress.refetch()} />
              : progress.data ? <>
                  <View style={styles.metrics}>
                    <Metric icon="book-open" label="Questões" value={progress.data.totalAnswered.toLocaleString('pt-BR')} />
                    <Metric icon="check-circle" label="Acertos" value={progress.data.totalCorrect.toLocaleString('pt-BR')} />
                    <Metric icon="target" label="Aproveitamento" value={`${Math.round(progress.data.accuracy * 100)}%`} />
                  </View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Por matéria</Text>
                  {progress.data.topics.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Responda questões para formar seu histórico.</Text> : progress.data.topics.map((topic) => (
                    <AppCard key={topic.topicId} radius={16} padding={14}>
                      <View style={styles.row}>
                        <View style={styles.flex}><Text style={[styles.subject, { color: colors.text }]}>{topic.topicName}</Text><Text style={[styles.meta, { color: colors.textSecondary }]}>{topic.observations} observações válidas</Text></View>
                        <Text style={[styles.accuracy, { color: colors.primary }]}>{Math.round(topic.probability * 100)}%</Text>
                      </View>
                    </AppCard>
                  ))}
                </> : null}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Arena</Text>
        <AppCard radius={20} padding={18}>
          {social.isLoading ? <LoadingState label="Conectando à Arena..." />
            : social.error ? <ErrorState error={social.error} onRetry={() => void social.refetch()} />
              : social.data?.enabled ? (
                <View style={styles.arena}>
                  <View style={[styles.arenaIcon, { backgroundColor: colors.primaryLight }]}><Feather name="users" size={22} color={colors.primary} /></View>
                  <View style={styles.flex}>
                    <Text style={[styles.arenaTitle, { color: colors.text }]}>{social.data.profile?.pseudonym || 'Seu perfil na Arena'}</Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{social.data.friendCount} amigos · {social.data.pendingInvites} convites · {social.data.activeDuels} duelos ativos</Text>
                  </View>
                </View>
              ) : <View style={styles.arena}><Feather name="shield" size={22} color={colors.textLight} /><View style={styles.flex}><Text style={[styles.arenaTitle, { color: colors.text }]}>Arena desativada</Text><Text style={[styles.meta, { color: colors.textSecondary }]}>Ative o perfil social nas configurações. Para menores, é necessária autorização do responsável.</Text></View></View>}
        </AppCard>
      </ScrollView>
    </View>
  );
}

function Metric({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) {
  const colors = useColors();
  return <AppCard radius={16} padding={14} style={styles.metric}><Feather name={icon} size={19} color={colors.primary} /><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text><Text style={[styles.metricLabel, { color: colors.textSecondary }]}>{label}</Text></AppCard>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { padding: 16, gap: 10 }, title: { fontSize: 28, fontWeight: '900', marginVertical: 6 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', gap: 5 }, metricValue: { fontSize: 21, fontWeight: '900' }, metricLabel: { fontSize: 11, fontWeight: '600' }, sectionTitle: { fontSize: 16, fontWeight: '800', marginTop: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, flex: { flex: 1 }, subject: { fontSize: 14, fontWeight: '700' }, meta: { fontSize: 12, lineHeight: 17, marginTop: 2 }, accuracy: { fontSize: 18, fontWeight: '900' }, empty: { fontSize: 13, paddingVertical: 16, textAlign: 'center' }, arena: { flexDirection: 'row', alignItems: 'center', gap: 12 }, arenaIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, arenaTitle: { fontSize: 15, fontWeight: '800' },
});
