import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/src/services/api/ApiProvider';
import type { SimulationResultDto } from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';

export default function SimulationResultScreen() {
  const { simulationId } = useLocalSearchParams<{ simulationId?: string }>();
  if (!simulationId) {
    return <ErrorState error={new Error('O identificador do simulado não foi informado.')} onRetry={() => router.replace('/(tabs)/simulados')} />;
  }
  return <RemoteResult simulationId={simulationId} />;
}

function RemoteResult({ simulationId }: { simulationId: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { client, networkState } = useApi();
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['simulation', simulationId, 'result'],
    queryFn: () => client.request<SimulationResultDto>(apiPaths.simulationResult(simulationId)),
    retry: 1,
  });
  if (query.isLoading) return <LoadingState label="Calculando resultado no servidor..." />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <ErrorState error={new Error('O resultado não foi retornado.')} onRetry={() => void query.refetch()} />;
  const result = query.data;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 20 : insets.top + 8, backgroundColor: colors.white, borderColor: colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar aos simulados" onPress={() => router.replace('/(tabs)/simulados')} style={styles.headerButton}><Feather name="x" size={20} color={colors.text} /></TouchableOpacity>
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.text }]}>Resultado</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]}>
        <AppCard radius={24} padding={22} style={styles.scoreCard}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>NOTA FINAL</Text>
          <Text accessibilityRole="summary" style={[styles.score, { color: colors.primary }]}>{result.score}</Text>
          <Text style={[styles.maxScore, { color: colors.textSecondary }]}>de {result.maxScore}</Text>
          <View style={styles.metrics}>
            <Metric label="Acertos" value={result.correctCount} color={colors.success} />
            <Metric label="Erros" value={result.incorrectCount} color={colors.error} />
            <Metric label="Em branco" value={result.unansweredCount} color={colors.textSecondary} />
          </View>
          <Text style={[styles.finalReason, { color: colors.textSecondary }]}>{result.finishReason === 'deadline' ? 'Encerrado pelo prazo oficial' : 'Encerrado após todas as respostas'}</Text>
        </AppCard>

        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Por matéria</Text>
        {result.subjects.map((subject) => (
          <AppCard key={subject.subjectId} radius={16} padding={15} style={styles.subjectCard}>
            <View style={styles.flex}>
              <Text style={[styles.subjectName, { color: colors.text }]}>{subject.subjectName}</Text>
              <Text style={[styles.subjectMeta, { color: colors.textSecondary }]}>{subject.correctCount} acertos · {subject.incorrectCount} erros · {subject.unansweredCount} em branco</Text>
            </View>
            <Text style={[styles.subjectScore, { color: colors.primary }]}>{subject.score}/{subject.maxScore}</Text>
          </AppCard>
        ))}

        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Correção completa</Text>
        {result.questions.map((question) => {
          const open = expanded === question.questionVersionId;
          const outcomeColor = question.isCorrect === true ? colors.success : question.isCorrect === false ? colors.error : colors.textSecondary;
          const outcomeLabel = question.isCorrect === true ? 'Correta' : question.isCorrect === false ? 'Incorreta' : 'Em branco';
          return (
            <AppCard key={question.questionVersionId} radius={16} padding={0} style={styles.reviewCard}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Questão ${question.position + 1}, ${outcomeLabel}. ${open ? 'Recolher correção' : 'Abrir correção'}`}
                accessibilityState={{ expanded: open }}
                onPress={() => setExpanded(open ? null : question.questionVersionId)}
                style={styles.reviewHeader}
              >
                <View style={[styles.outcomeIcon, { backgroundColor: `${outcomeColor}18` }]}><Feather name={question.isCorrect === true ? 'check' : question.isCorrect === false ? 'x' : 'minus'} color={outcomeColor} size={18} /></View>
                <View style={styles.flex}><Text style={[styles.questionTitle, { color: colors.text }]}>Questão {question.position + 1}</Text><Text style={[styles.subjectMeta, { color: outcomeColor }]}>{question.subject.name} · {outcomeLabel}</Text></View>
                <Feather name={open ? 'chevron-up' : 'chevron-down'} color={colors.textSecondary} size={20} />
              </TouchableOpacity>
              {open ? (
                <View style={[styles.reviewBody, { borderColor: colors.border }]}>
                  <Text style={[styles.statement, { color: colors.text }]}>{question.statement}</Text>
                  {question.options.map((option) => {
                    const correct = option.id === question.correctOptionId;
                    const selected = option.id === question.selectedOptionId;
                    return (
                      <View key={option.id} style={[styles.option, { borderColor: correct ? colors.success : selected ? colors.error : colors.border, backgroundColor: correct ? `${colors.success}10` : selected ? `${colors.error}08` : colors.white }]}>
                        <Text style={[styles.optionKey, { color: correct ? colors.success : selected ? colors.error : colors.textSecondary }]}>{option.key}</Text>
                        <View style={styles.flex}>
                          <Text style={[styles.optionText, { color: colors.text }]}>{option.body}</Text>
                          {(correct || selected) ? <Text style={[styles.rationale, { color: colors.textSecondary }]}>{option.rationale}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                  <View style={[styles.solution, { backgroundColor: colors.primaryLight }]}><Text style={[styles.solutionTitle, { color: colors.primary }]}>Solução</Text><Text style={[styles.solutionText, { color: colors.text }]}>{question.solution}</Text></View>
                </View>
              ) : null}
            </AppCard>
          );
        })}
        {networkState === 'offline' ? <Text accessibilityRole="alert" style={[styles.offline, { color: colors.error }]}>A correção já carregada continua visível, mas novos resultados exigem conexão.</Text> : null}
        <AppButton title="Voltar aos simulados" fullWidth size="lg" onPress={() => router.replace('/(tabs)/simulados')} />
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 64, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerTitle: { fontSize: 17, fontWeight: '900' }, scroll: { padding: 16, gap: 12 }, scoreCard: { alignItems: 'center', gap: 3 }, eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 }, score: { fontSize: 54, lineHeight: 62, fontWeight: '900' }, maxScore: { fontSize: 14 }, metrics: { width: '100%', flexDirection: 'row', justifyContent: 'space-around', marginTop: 15 }, metric: { alignItems: 'center', gap: 2 }, metricValue: { fontSize: 21, fontWeight: '900' }, metricLabel: { color: '#64748B', fontSize: 11, fontWeight: '700' }, finalReason: { fontSize: 12, marginTop: 12 }, sectionTitle: { fontSize: 18, fontWeight: '900', marginTop: 7 }, subjectCard: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, subjectName: { fontSize: 14, fontWeight: '800' }, subjectMeta: { fontSize: 11, marginTop: 3 }, subjectScore: { fontSize: 16, fontWeight: '900' }, reviewCard: { overflow: 'hidden' }, reviewHeader: { minHeight: 70, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, outcomeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, questionTitle: { fontSize: 14, fontWeight: '800' }, reviewBody: { borderTopWidth: 1, padding: 15, gap: 10 }, statement: { fontSize: 14, lineHeight: 21, marginBottom: 3 }, option: { flexDirection: 'row', gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 }, optionKey: { width: 22, fontWeight: '900' }, optionText: { fontSize: 13, lineHeight: 19 }, rationale: { fontSize: 11, lineHeight: 16, marginTop: 5 }, solution: { borderRadius: 12, padding: 13, gap: 5 }, solutionTitle: { fontSize: 12, fontWeight: '900' }, solutionText: { fontSize: 13, lineHeight: 20 }, offline: { textAlign: 'center', fontSize: 12 },
});
