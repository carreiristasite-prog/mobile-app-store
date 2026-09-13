import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { AttemptResultDto, SessionQuestionDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { toUserMessage } from '@/src/services/api/types';

export default function QuizScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptResultDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  const query = useQuery({
    queryKey: ['learning-session', sessionId, 'next'],
    queryFn: () => client.request<SessionQuestionDto>(apiPaths.learningSessionNext(sessionId!)),
    enabled: Boolean(sessionId && client.configured),
    retry: 1,
  });

  const submit = async () => {
    if (!sessionId || !selected || !query.data?.question) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await client.mutate<AttemptResultDto>(apiPaths.learningSessionAttempts(sessionId), {
        method: 'POST',
        body: {
          exposureId: query.data.question.exposureId,
          selectedOptionId: selected,
          elapsedMs: Math.min(7_200_000, Math.max(250, Date.now() - shownAt.current)),
        },
        offlineQueue: 'non_competitive_learning_attempt',
      });
      if (result.state === 'queued') {
        Alert.alert('Resposta salva', 'Vamos sincronizar sua resposta quando a conexão voltar.');
        router.replace('/(tabs)/questions');
        return;
      }
      setAttempt(result.data);
    } catch (error) {
      setSubmitError(toUserMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    Alert.alert('Sessão concluída', 'Seu progresso foi atualizado pelo servidor.', [{ text: 'Ver progresso', onPress: () => router.replace('/(tabs)/performance') }]);
  };

  const next = async () => {
    setSelected(null);
    if (!attempt?.nextQuestion) {
      finish();
      return;
    }
    setAttempt(null);
    shownAt.current = Date.now();
    await queryClient.invalidateQueries({ queryKey: ['learning-session', sessionId, 'next'] });
  };

  const report = () => {
    const send = async (reason: string) => {
      if (!query.data?.question) return;
      try {
        await client.mutate(apiPaths.reports, {
          method: 'POST',
          body: { targetType: 'question', targetId: query.data.question.questionVersionId, reason },
        });
        Alert.alert('Obrigado', 'A questão será revisada pela equipe editorial.');
      } catch (reportError) {
        Alert.alert('Não foi possível enviar', toUserMessage(reportError));
      }
    };
    Alert.alert('Reportar questão', 'Qual é o problema?', [
      { text: 'Possível resposta incorreta', onPress: () => void send('incorrect') },
      { text: 'Conteúdo desatualizado', onPress: () => void send('outdated') },
      { text: 'Outro problema', onPress: () => void send('other') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  if (!sessionId) return <ErrorState error={new Error('Inicie uma sessão pela aba Questões.')} onRetry={() => router.replace('/(tabs)/questions')} />;
  if (query.isLoading) return <LoadingState label="Carregando questão..." />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data?.question) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Feather name="check-circle" size={44} color={colors.success} /><Text style={[styles.doneTitle, { color: colors.text }]}>Sessão concluída</Text><AppButton title="Ver progresso" onPress={() => router.replace('/(tabs)/performance')} /></View>;
  }

  const { question } = query.data;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 20 : insets.top + 8, backgroundColor: colors.white, borderColor: colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sair da sessão" onPress={() => router.back()} style={styles.close}><Feather name="x" size={21} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.progress, { color: colors.text }]}>Questão {question.sequence}</Text>
        <View style={styles.close} />
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}><Text style={[styles.badgeText, { color: colors.primary }]}>{question.subject.name}</Text></View>
          <Text style={[styles.source, { color: colors.textSecondary }]}>{question.topic.name}</Text>
        </View>
        <AppCard radius={20} padding={20}><Text style={[styles.statement, { color: colors.text }]}>{question.statement}</Text></AppCard>
        <View style={styles.options} accessibilityRole="radiogroup">
          {question.options.map((option) => {
            const isSelected = selected === option.id;
            const isCorrect = attempt?.correctOptionId === option.id;
            const isWrong = Boolean(attempt && isSelected && !attempt.isCorrect);
            const borderColor = isCorrect ? colors.success : isWrong ? colors.error : isSelected ? colors.primary : colors.border;
            return <TouchableOpacity key={option.id} accessibilityRole="radio" accessibilityState={{ selected: isSelected, disabled: Boolean(attempt) }} disabled={Boolean(attempt)} onPress={() => setSelected(option.id)} style={[styles.option, { backgroundColor: colors.white, borderColor }]}><View style={[styles.letter, { backgroundColor: isSelected ? colors.primary : colors.muted }]}><Text style={[styles.letterText, { color: isSelected ? '#FFF' : colors.textSecondary }]}>{option.key}</Text></View><Text style={[styles.optionText, { color: colors.text }]}>{option.body}</Text></TouchableOpacity>;
          })}
        </View>
        {attempt ? <AppCard radius={16} padding={16} style={{ borderLeftWidth: 4, borderLeftColor: attempt.isCorrect ? colors.success : colors.error }}><Text style={[styles.feedbackTitle, { color: attempt.isCorrect ? colors.success : colors.error }]}>{attempt.isCorrect ? 'Resposta correta' : 'Resposta incorreta'}</Text><Text style={[styles.feedback, { color: colors.textSecondary }]}>{attempt.solution}</Text></AppCard> : null}
        {submitError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{submitError}</Text> : null}
        <AppButton title={attempt ? (attempt.nextQuestion ? 'Próxima questão' : 'Concluir sessão') : 'Confirmar resposta'} onPress={() => attempt ? void next() : void submit()} fullWidth size="lg" loading={submitting} disabled={!selected} />
        <TouchableOpacity accessibilityRole="button" onPress={report} style={styles.report}><Feather name="alert-triangle" size={14} color={colors.textSecondary} /><Text style={[styles.reportText, { color: colors.textSecondary }]}>Reportar problema</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }, doneTitle: { fontSize: 22, fontWeight: '900' }, header: { minHeight: 64, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, progress: { fontSize: 14, fontWeight: '800' }, scroll: { padding: 16, gap: 14 }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, badge: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 99 }, badgeText: { fontSize: 11, fontWeight: '800' }, source: { fontSize: 11, fontWeight: '600' }, statement: { fontSize: 16, lineHeight: 25, fontWeight: '500' }, options: { gap: 10 }, option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 }, letter: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, letterText: { fontSize: 13, fontWeight: '800' }, optionText: { flex: 1, fontSize: 14, lineHeight: 20 }, feedbackTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 }, feedback: { fontSize: 13, lineHeight: 20 }, error: { textAlign: 'center', fontSize: 13 }, report: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44 }, reportText: { fontSize: 12, fontWeight: '700' },
});
