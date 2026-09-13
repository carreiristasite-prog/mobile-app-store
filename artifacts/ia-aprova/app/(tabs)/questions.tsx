import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { ActiveCatalogDto, HomeDto, LearningSessionDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { ApiConfigurationError, toUserMessage } from '@/src/services/api/types';

export default function QuestionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client, networkState } = useApi();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['questions', 'catalog-setup'],
    queryFn: async () => {
      const [catalog, home] = await Promise.all([
        client.request<ActiveCatalogDto>(apiPaths.activeCatalog),
        client.request<HomeDto>(apiPaths.home),
      ]);
      return { catalog, home };
    },
    enabled: client.configured,
    retry: 1,
  });
  const products = query.data?.catalog.products || [];
  const activeProductId = selectedProductId || query.data?.home.activeProductId || products[0]?.id || null;

  const start = async () => {
    if (!activeProductId) return;
    setStartError(null);
    setStarting(true);
    try {
      const result = await client.mutate<LearningSessionDto>(apiPaths.learningSessions, {
        method: 'POST',
        body: { productId: activeProductId, mode: 'practice' },
      });
      if (result.state === 'completed') {
        if (result.data.status === 'completed' || !result.data.nextQuestion) {
          setStartError('Ainda não há questões publicadas para este edital.');
        } else {
          router.push({ pathname: '/quiz', params: { sessionId: result.data.sessionId } });
        }
      }
    } catch (error) {
      setStartError(toUserMessage(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 96 : insets.bottom + 88 }]}>
        <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Questões</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]}>A seleção é feita no servidor sem enviar o gabarito ao aparelho.</Text></View>
        {!client.configured ? <ErrorState error={new ApiConfigurationError()} />
          : query.isLoading ? <LoadingState label="Carregando concursos..." />
            : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
              : products.length === 0 ? <EmptyState title="Catálogo em auditoria" message="Nenhum concurso está publicado para estudo neste ambiente." />
                : <>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Concurso da sessão</Text>
                    {products.map((product) => {
                      const selected = activeProductId === product.id;
                      return <TouchableOpacity key={product.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setSelectedProductId(product.id)}><AppCard radius={16} padding={15} style={[styles.product, { borderColor: selected ? colors.primary : colors.border }]}><View style={[styles.icon, { backgroundColor: colors.primaryLight }]}><Feather name="flag" size={18} color={colors.primary} /></View><View style={styles.flex}><Text style={[styles.productName, { color: colors.text }]}>{product.name}</Text><Text style={[styles.productMeta, { color: colors.textSecondary }]}>{product.defaultTrack || product.category} · {product.examVersions.length} {product.examVersions.length === 1 ? 'edital ativo' : 'editais ativos'}</Text></View>{selected ? <Feather name="check-circle" size={20} color={colors.primary} /> : null}</AppCard></TouchableOpacity>;
                    })}
                    <AppCard radius={16} padding={14} style={{ backgroundColor: colors.primaryLight }}><View style={styles.notice}><Feather name="compass" size={17} color={colors.primary} /><Text style={[styles.noticeText, { color: colors.primaryDark }]}>A sessão prioriza fraquezas, revisões pendentes e cobertura do edital. A correção vem somente do servidor.</Text></View></AppCard>
                    {startError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{startError}</Text> : null}
                    <AppButton title={networkState === 'offline' ? 'Conecte-se para iniciar' : 'Iniciar sessão adaptativa'} onPress={() => void start()} fullWidth size="lg" loading={starting} disabled={!activeProductId || networkState === 'offline'} />
                  </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { padding: 16, gap: 10 }, heading: { gap: 4, marginVertical: 6 }, title: { fontSize: 28, fontWeight: '900' }, subtitle: { fontSize: 13, lineHeight: 19 }, sectionTitle: { fontSize: 15, fontWeight: '800', marginTop: 6 }, product: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 }, icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, productName: { fontSize: 14, fontWeight: '800' }, productMeta: { fontSize: 11, lineHeight: 16, marginTop: 2 }, notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, noticeText: { flex: 1, fontSize: 12, lineHeight: 18 }, error: { fontSize: 13, textAlign: 'center' },
});
