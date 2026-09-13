import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import AppCard from '@/components/AppCard';
import { useColors } from '@/hooks/useColors';
import { MONTHLY_PRODUCT_ID, useBilling } from '@/src/services/billing/BillingProvider';
import { PurchaseCancelledError } from '@/src/services/billing/purchases.types';
import { toUserMessage } from '@/src/services/api/types';
import { EXTERNAL_LINKS } from '@/constants/links';

const FEATURES = [
  ['book-open', 'Trilhas disponíveis', 'Acesso Pro aos catálogos que concluíram a auditoria editorial.'],
  ['clipboard', 'Simulados ilimitados', 'Sessões baseadas na distribuição dos blueprints publicados.'],
  ['bar-chart-2', 'Análises detalhadas', 'Histórico por matéria e revisão personalizada.'],
] as const;

export default function ProScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const billing = useBilling();
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const offering = billing.offering;
  const isPro = billing.entitlement?.active === true;

  const run = async (action: 'purchase' | 'restore') => {
    setBusy(action);
    try {
      const submission = action === 'purchase'
        ? await billing.purchaseMonthly()
        : await billing.restore();
      Alert.alert(
        submission === 'pending_validation'
          ? (action === 'purchase' ? 'Compra concluída pela loja' : 'Restauração concluída pela loja')
          : (action === 'purchase' ? 'Compra recebida' : 'Restauração solicitada'),
        submission === 'pending_validation'
          ? 'A loja concluiu a operação, mas a confirmação do servidor está temporariamente pendente. Não compre novamente: tentaremos atualizar seu acesso automaticamente.'
          : 'Estamos confirmando a assinatura com o servidor. O acesso Pro será atualizado somente após essa validação.',
      );
    } catch (error) {
      if (error instanceof PurchaseCancelledError) return;
      Alert.alert('Assinatura', toUserMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 20 : insets.top + 8, backgroundColor: colors.primary }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fechar" onPress={() => router.back()} style={styles.close}><Feather name="x" size={21} color="#FFF" /></TouchableOpacity>
        <View style={styles.star}><Feather name="star" size={25} color="#FCD34D" /></View>
        <Text style={styles.title}>IA Aprova Pro</Text>
        <Text style={styles.subtitle}>Um plano mensal. Benefícios claros. Cancele quando quiser pela loja.</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        {FEATURES.map(([icon, title, body]) => <AppCard key={title} radius={16} padding={14} style={styles.feature}><View style={[styles.featureIcon, { backgroundColor: colors.primaryLight }]}><Feather name={icon} size={18} color={colors.primary} /></View><View style={styles.flex}><Text style={[styles.featureTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.featureBody, { color: colors.textSecondary }]}>{body}</Text></View></AppCard>)}

        <AppCard radius={20} padding={18} style={{ borderWidth: 2, borderColor: colors.primary }}>
          <View style={styles.planTop}><View><Text style={[styles.planName, { color: colors.text }]}>Plano mensal</Text><Text style={[styles.productId, { color: colors.textLight }]}>{MONTHLY_PRODUCT_ID}</Text></View><Text style={[styles.price, { color: colors.primary }]}>{offering?.localizedPrice || 'Preço da loja'}</Text></View>
          <Text style={[styles.renewal, { color: colors.textSecondary }]}>Renovação automática mensal. O preço final e os impostos são exibidos pela App Store ou Google Play antes da confirmação.</Text>
        </AppCard>

        {isPro ? <View accessibilityRole="alert" style={styles.active}><Feather name="check-circle" size={19} color={colors.success} /><Text style={[styles.activeText, { color: colors.success }]}>Sua assinatura Pro está ativa.</Text></View> : null}
        {billing.error ? <View accessibilityRole="alert" style={styles.billingError}><Feather name="alert-circle" size={18} color={colors.error} /><View style={styles.flex}><Text style={[styles.billingErrorTitle, { color: colors.error }]}>Não foi possível consultar sua assinatura</Text><Text style={[styles.billingErrorBody, { color: colors.textSecondary }]}>{toUserMessage(billing.error)}</Text></View><AppButton title="Tentar" onPress={() => void billing.refresh()} size="sm" variant="outline" /></View> : null}
        <AppButton title={isPro ? 'Pro ativo' : billing.nativePurchasesAvailable && offering?.available ? 'Assinar plano mensal' : 'Compras indisponíveis neste build'} onPress={() => void run('purchase')} loading={busy === 'purchase' || billing.loading} disabled={isPro || !billing.nativePurchasesAvailable || !offering?.available} fullWidth size="lg" />
        <AppButton title="Restaurar compras" onPress={() => void run('restore')} loading={busy === 'restore'} disabled={!billing.nativePurchasesAvailable} fullWidth variant="ghost" />
        {!isPro ? <Text style={[styles.freePlan, { color: colors.textSecondary }]}>Você pode fechar esta tela e continuar usando o plano gratuito.</Text> : null}
        {Platform.OS !== 'web' ? (
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel="Gerenciar ou cancelar assinatura na loja"
            onPress={() => void Linking.openURL(Platform.OS === 'ios'
              ? 'https://apps.apple.com/account/subscriptions'
              : 'https://play.google.com/store/account/subscriptions?package=br.com.iaaprova.app')}
            style={styles.manageLink}
          >
            <Text style={[styles.manageLinkText, { color: colors.primary }]}>Gerenciar ou cancelar na loja</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.disclaimer, { color: colors.textLight }]}>A assinatura só é ativada depois da confirmação da loja e da validação do servidor. O aplicativo não libera benefícios apenas com estado local.</Text>
        <Text style={[styles.legal, { color: colors.textLight }]}>Ao assinar, aplicam-se os <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.terms)} style={{ color: colors.primary }}>Termos de Uso</Text> e a <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.privacy)} style={{ color: colors.primary }}>Política de Privacidade</Text>. Esta informação não registra aceite.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { paddingHorizontal: 20, paddingBottom: 26, alignItems: 'center', gap: 8 }, close: { alignSelf: 'flex-end', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, star: { width: 58, height: 58, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }, title: { color: '#FFF', fontSize: 25, fontWeight: '900' }, subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 340 }, scroll: { padding: 16, gap: 10 }, feature: { flexDirection: 'row', alignItems: 'center', gap: 12 }, featureIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, featureTitle: { fontSize: 14, fontWeight: '800' }, featureBody: { fontSize: 12, lineHeight: 17, marginTop: 2 }, planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, planName: { fontSize: 16, fontWeight: '900' }, productId: { fontSize: 10, marginTop: 2 }, price: { fontSize: 20, fontWeight: '900' }, renewal: { fontSize: 12, lineHeight: 18, marginTop: 12 }, active: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#F0FDF4', padding: 12, borderRadius: 12 }, activeText: { fontSize: 13, fontWeight: '800' }, billingError: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12 }, billingErrorTitle: { fontSize: 13, fontWeight: '800' }, billingErrorBody: { fontSize: 11, lineHeight: 16, marginTop: 2 }, freePlan: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 }, manageLink: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 10 }, manageLinkText: { fontSize: 13, fontWeight: '700', textAlign: 'center' }, disclaimer: { fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 10 }, legal: { fontSize: 10, lineHeight: 15, textAlign: 'center', paddingHorizontal: 10 },
});
