import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useApi } from '@/src/services/api/ApiProvider';

export default function NetworkStatusBanner() {
  const { networkState, pendingSync, outboxSummary, outboxErrorCode, syncNow } = useApi();
  const retainedErrors = (outboxSummary?.serverRejected ?? 0) + (outboxSummary?.attemptsExhausted ?? 0);
  const outboxAttention = Boolean(outboxErrorCode || retainedErrors > 0);
  if ((networkState === 'online' || networkState === 'checking') && !outboxAttention && pendingSync === 0) return null;

  const unconfigured = networkState === 'unconfigured';
  const attention = !unconfigured && outboxAttention;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: unconfigured || attention ? '#FEF3C7' : '#EFF6FF' }]}
    >
      <Feather name={unconfigured ? 'tool' : attention ? 'alert-triangle' : 'wifi-off'} size={14} color={unconfigured || attention ? '#92400E' : '#1E40AF'} />
      <Text style={[styles.text, { color: unconfigured || attention ? '#92400E' : '#1E40AF' }]}> 
        {unconfigured
          ? 'API não configurada neste build.'
          : outboxErrorCode
            ? 'A fila offline não pôde ser lida com segurança.'
            : retainedErrors > 0
              ? `${retainedErrors} ${retainedErrors === 1 ? 'resposta offline requer' : 'respostas offline requerem'} reconciliação.`
          : pendingSync > 0
            ? `${pendingSync} ${pendingSync === 1 ? 'resposta aguarda' : 'respostas aguardam'} sincronização.`
            : 'Sem conexão · recursos online estão temporariamente indisponíveis.'}
      </Text>
      {!unconfigured && retainedErrors === 0 ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Tentar sincronizar agora"
          onPress={() => void syncNow()}
          style={styles.action}
        >
          <Text style={styles.actionText}>Tentar</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: { flex: 1, fontSize: 12, fontWeight: '600' },
  action: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 6 },
  actionText: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' },
});
