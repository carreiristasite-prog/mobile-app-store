import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { SimulationBlueprintDto, SimulationSessionDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { ApiConfigurationError, toUserMessage } from '@/src/services/api/types';

export default function SimulationsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client, networkState } = useApi();
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pendingStartRef = useRef<{ blueprintVersionId: string; key: string } | null>(null);
  const query = useQuery({
    queryKey: ['simulations', 'blueprints'],
    queryFn: () => client.request<{ blueprints: SimulationBlueprintDto[] }>(apiPaths.simulationBlueprints),
    enabled: client.configured,
    retry: 1,
  });
  const activeQuery = useQuery({
    queryKey: ['simulations', 'active'],
    queryFn: () => client.request<{ simulation: SimulationSessionDto | null }>(apiPaths.activeSimulation),
    enabled: client.configured,
    retry: 1,
  });
  const items = query.data?.blueprints || [];
  const resumable = activeQuery.data?.simulation ?? null;

  const start = async () => {
    if (!selected) return;
    if (!pendingStartRef.current || pendingStartRef.current.blueprintVersionId !== selected) {
      pendingStartRef.current = {
        blueprintVersionId: selected,
        key: `simulation-create-${Crypto.randomUUID()}`,
      };
    }
    setStarting(true);
    setStartError(null);
    try {
      const result = await client.mutate<SimulationSessionDto>(apiPaths.simulations, {
        method: 'POST',
        body: { blueprintVersionId: selected },
        idempotencyKey: pendingStartRef.current.key,
      });
      if (result.state === 'completed') {
        pendingStartRef.current = null;
        router.push({ pathname: '/simulados/active', params: { simulationId: result.data.simulationId } });
      }
    } catch (error) {
      // A response can be lost after the server commits. Re-read the
      // authoritative active session before presenting a retry. If no session
      // is found, retain the exact key so the next tap is an idempotent replay.
      const recovered = await activeQuery.refetch().catch(() => null);
      const simulation = recovered?.data?.simulation ?? null;
      if (simulation) {
        pendingStartRef.current = null;
        router.push({
          pathname: simulation.status === 'active' ? '/simulados/active' : '/simulados/result',
          params: { simulationId: simulation.simulationId },
        });
      } else {
        setStartError(toUserMessage(error));
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 96 : insets.bottom + 88 }]}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Simulados</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Blueprint, tempo e pontuação definidos pelo edital.</Text>
        </View>
        {resumable ? (
          <AppCard radius={18} padding={16} style={[styles.resume, { borderColor: colors.primary }]}>
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{resumable.status === 'active' ? 'Simulado em andamento' : 'Resultado disponível'}</Text>
              <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>Seu estado foi salvo pelo servidor. Continue online em qualquer aparelho.</Text>
            </View>
            <AppButton
              title={resumable.status === 'active' ? 'Continuar' : 'Ver resultado'}
              size="sm"
              onPress={() => router.push({
                pathname: resumable.status === 'active' ? '/simulados/active' : '/simulados/result',
                params: { simulationId: resumable.simulationId },
              })}
            />
          </AppCard>
        ) : null}
        {!client.configured ? <ErrorState error={new ApiConfigurationError()} />
          : query.isLoading ? <LoadingState label="Carregando provas..." />
            : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
              : items.length === 0 ? <EmptyState title="Nenhum simulado liberado" message="Publicaremos apenas provas que concluíram a auditoria editorial." />
                : <>
                    {items.map((item) => {
                      const isSelected = selected === item.id;
                      return (
                        <TouchableOpacity key={item.id} accessibilityRole="radio" accessibilityState={{ selected: isSelected, disabled: starting }} disabled={starting} onPress={() => setSelected(item.id)} activeOpacity={0.85}>
                          <AppCard radius={18} padding={16} style={[styles.card, { borderColor: isSelected ? colors.primary : colors.border }]}>
                            <View style={[styles.icon, { backgroundColor: colors.primaryLight }]}><Feather name="clipboard" size={20} color={colors.primary} /></View>
                            <View style={styles.flex}>
                              <Text style={[styles.cardTitle, { color: colors.text }]}>Simulado · versão {item.version}</Text>
                              <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>{ruleLabel(item.rules)}</Text>
                            </View>
                            {isSelected ? <Feather name="check-circle" size={20} color={colors.primary} /> : null}
                          </AppCard>
                        </TouchableOpacity>
                      );
                    })}
                    {startError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{startError}</Text> : null}
                    <AppButton title={networkState === 'offline' ? 'Conecte-se para iniciar' : 'Iniciar simulado'} onPress={() => void start()} fullWidth size="lg" loading={starting} disabled={!selected || networkState === 'offline'} />
                  </>}
      </ScrollView>
    </View>
  );
}

function ruleLabel(rules: SimulationBlueprintDto['rules']): string {
  return `${rules.questionCount} questões · ${rules.durationMinutes} min`;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { padding: 16, gap: 12 }, heading: { gap: 4, marginVertical: 6 }, title: { fontSize: 28, fontWeight: '900' }, subtitle: { fontSize: 13, lineHeight: 19 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 }, resume: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 }, icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, cardTitle: { fontSize: 15, fontWeight: '800' }, cardMeta: { fontSize: 12, marginTop: 3 }, error: { textAlign: 'center', fontSize: 13 },
});
