import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import AppCard from '@/components/AppCard';
import AppButton from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { useApi } from '@/src/services/api/ApiProvider';
import type { SimulationAnswerDto, SimulationSessionDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { toUserMessage } from '@/src/services/api/types';

export default function ActiveSimuladoScreen() {
  const { simulationId } = useLocalSearchParams<{ simulationId?: string }>();
  if (!simulationId) {
    return <ErrorState error={new Error('Inicie um simulado pela aba Simulados.')} onRetry={() => router.replace('/(tabs)/simulados')} />;
  }
  return <RemoteSimulation simulationId={simulationId} />;
}

function RemoteSimulation({ simulationId }: { simulationId: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client, networkState } = useApi();
  const queryClient = useQueryClient();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const clockOffsetRef = useRef(0);
  const pendingRef = useRef<{ signature: string; key: string } | null>(null);
  const query = useQuery({
    queryKey: ['simulation', simulationId],
    queryFn: () => client.request<SimulationSessionDto>(apiPaths.simulation(simulationId)),
    retry: 1,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && networkState !== 'offline') void query.refetch();
    });
    return () => subscription.remove();
  }, [networkState, query]);

  useEffect(() => {
    if (!query.data) return;
    clockOffsetRef.current = Date.parse(query.data.serverNow) - Date.now();
    const update = () => setRemainingMs(Math.max(0, Date.parse(query.data!.deadlineAt) - (Date.now() + clockOffsetRef.current)));
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [query.data]);

  useEffect(() => {
    if (!query.data || query.data.status !== 'active') return;
    const current = query.data.questions[questionIndex];
    if (current && !query.data.answeredQuestionVersionIds.includes(current.questionVersionId)) return;
    const firstPending = query.data.questions.findIndex((question) => !query.data!.answeredQuestionVersionIds.includes(question.questionVersionId));
    if (firstPending >= 0) setQuestionIndex(firstPending);
  }, [query.data, questionIndex]);

  useEffect(() => {
    if (query.data?.status === 'finalized') {
      router.replace({ pathname: '/simulados/result', params: { simulationId } });
    }
  }, [query.data?.status, simulationId]);

  useEffect(() => {
    if (remainingMs !== 0 || !query.data || query.data.status !== 'active' || networkState === 'offline') return;
    void query.refetch();
  }, [networkState, query, query.data, remainingMs]);

  const answeredByQuestion = useMemo(
    () => new Map(query.data?.answers.map((answer) => [answer.questionVersionId, answer.selectedOptionId]) ?? []),
    [query.data?.answers],
  );
  const question = query.data?.questions[questionIndex];
  const storedSelection = question ? answeredByQuestion.get(question.questionVersionId) ?? null : null;
  const effectiveSelection = storedSelection ?? selected;
  const alreadyAnswered = storedSelection !== null;
  const expiredLocally = remainingMs <= 0;

  const choose = (optionId: string) => {
    if (alreadyAnswered || expiredLocally || submitting) return;
    setSelected(optionId);
    pendingRef.current = null;
    setError(null);
  };

  const submit = async () => {
    const session = query.data;
    if (!selected || !question || !session || alreadyAnswered || expiredLocally || networkState === 'offline') return;
    setSubmitting(true);
    setError(null);
    const signature = `${question.questionVersionId}:${selected}`;
    if (!pendingRef.current || pendingRef.current.signature !== signature) {
      pendingRef.current = { signature, key: `simulation-${Crypto.randomUUID()}` };
    }
    try {
      const result = await client.mutate<SimulationAnswerDto>(apiPaths.simulationAnswers(simulationId), {
        method: 'POST',
        body: { questionVersionId: question.questionVersionId, selectedOptionId: selected },
        idempotencyKey: pendingRef.current.key,
      });
      if (result.state !== 'completed') throw new Error('Respostas de simulado exigem conexão com o servidor.');
      pendingRef.current = null;
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['simulation', simulationId] });
      await queryClient.invalidateQueries({ queryKey: ['simulations', 'active'] });
      if (result.data.resultAvailable) {
        router.replace({ pathname: '/simulados/result', params: { simulationId } });
      } else {
        const answered = new Set(result.data.answeredQuestionVersionIds);
        const next = session.questions.findIndex((candidate) => !answered.has(candidate.questionVersionId));
        if (next >= 0) setQuestionIndex(next);
      }
    } catch (submitError) {
      setError(toUserMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  if (query.isLoading) return <LoadingState label="Carregando simulado..." />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data || !question) return <ErrorState error={new Error('O snapshot deste simulado está incompleto.')} onRetry={() => void query.refetch()} />;

  const answeredCount = query.data.answeredQuestionVersionIds.length;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 20 : insets.top + 8, backgroundColor: colors.white, borderColor: colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sair; o relógio continuará correndo" onPress={() => router.back()} style={styles.headerButton}>
          <Feather name="x" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.progress, { color: colors.text }]}>Questão {questionIndex + 1} de {query.data.questions.length}</Text>
          <Text accessibilityRole="timer" accessibilityLiveRegion="none" style={[styles.timer, { color: remainingMs < 60_000 ? colors.error : colors.primary }]}>
            {formatRemaining(remainingMs)}
          </Text>
        </View>
        <View style={styles.headerButton}><Text style={[styles.counter, { color: colors.textSecondary }]}>{answeredCount}/{query.data.questions.length}</Text></View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navigator} accessibilityRole="tablist">
          {query.data.questions.map((item, index) => {
            const answered = answeredByQuestion.has(item.questionVersionId);
            const current = index === questionIndex;
            return (
              <TouchableOpacity
                key={item.questionVersionId}
                accessibilityRole="tab"
                accessibilityLabel={`Questão ${index + 1}${answered ? ', respondida' : ', não respondida'}`}
                accessibilityState={{ selected: current, disabled: submitting }}
                disabled={submitting}
                onPress={() => { setQuestionIndex(index); setSelected(null); pendingRef.current = null; }}
                style={[styles.navItem, { backgroundColor: current ? colors.primary : answered ? colors.primaryLight : colors.white, borderColor: current || answered ? colors.primary : colors.border }]}
              >
                <Text style={{ color: current ? '#FFF' : answered ? colors.primary : colors.textSecondary, fontWeight: '800' }}>{index + 1}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}><Text style={[styles.badgeText, { color: colors.primary }]}>{question.subject.name}</Text></View>
        <AppCard radius={20} padding={20}><Text style={[styles.statement, { color: colors.text }]}>{question.statement}</Text></AppCard>
        <View style={styles.options} accessibilityRole="radiogroup">
          {question.options.map((option) => {
            const active = effectiveSelection === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: alreadyAnswered || expiredLocally || submitting }}
                accessibilityLabel={`${option.key}. ${option.body}`}
                disabled={alreadyAnswered || expiredLocally || submitting}
                onPress={() => choose(option.id)}
                style={[styles.option, { backgroundColor: colors.white, borderColor: active ? colors.primary : colors.border, opacity: alreadyAnswered && !active ? 0.62 : 1 }]}
              >
                <View style={[styles.letter, { backgroundColor: active ? colors.primary : colors.muted }]}><Text style={{ color: active ? '#FFF' : colors.textSecondary, fontWeight: '800' }}>{option.key}</Text></View>
                <Text style={[styles.optionText, { color: colors.text }]}>{option.body}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {alreadyAnswered ? <Text style={[styles.notice, { color: colors.textSecondary }]}>Resposta salva. A correção será mostrada somente após o encerramento.</Text> : null}
        {expiredLocally ? <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>O tempo terminou. Reconecte para o servidor finalizar o resultado.</Text> : null}
        {networkState === 'offline' ? <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>Sem conexão. Por segurança, respostas de simulado não são salvas offline.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>{error}</Text> : null}
        {!alreadyAnswered ? <AppButton title="Salvar resposta" onPress={() => void submit()} loading={submitting} disabled={!selected || expiredLocally || networkState === 'offline' || submitting} fullWidth size="lg" /> : null}
        <View style={styles.actions}>
          <AppButton title="Anterior" variant="outline" onPress={() => { setQuestionIndex(Math.max(0, questionIndex - 1)); setSelected(null); pendingRef.current = null; }} disabled={submitting || questionIndex === 0} />
          <AppButton title="Próxima" variant="outline" onPress={() => { setQuestionIndex(Math.min(query.data.questions.length - 1, questionIndex + 1)); setSelected(null); pendingRef.current = null; }} disabled={submitting || questionIndex === query.data.questions.length - 1} />
        </View>
      </ScrollView>
    </View>
  );
}

function formatRemaining(value: number): string {
  const totalSeconds = Math.max(0, Math.ceil(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 64, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerButton: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, headerCenter: { alignItems: 'center', gap: 2 }, progress: { fontSize: 13, fontWeight: '800' }, timer: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] }, counter: { fontSize: 12, fontWeight: '800' }, scroll: { padding: 16, gap: 14 }, navigator: { gap: 8, paddingVertical: 2 }, navItem: { width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }, badge: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 99 }, badgeText: { fontSize: 11, fontWeight: '800' }, statement: { fontSize: 16, lineHeight: 25 }, options: { gap: 10 }, option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 }, letter: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, optionText: { flex: 1, fontSize: 14, lineHeight: 20 }, notice: { textAlign: 'center', fontSize: 13, lineHeight: 19 }, actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
});
