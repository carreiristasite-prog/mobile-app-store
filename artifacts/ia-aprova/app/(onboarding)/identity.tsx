import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { EXTERNAL_LINKS } from '@/constants/links';
import { useColors } from '@/hooks/useColors';
import {
  useCreateGuardianInvitation,
  useGuardianLinks,
  useOnboardingState,
  useRecordLegalAcknowledgement,
  useRecordOptionalConsent,
  useReportPlatformAgeSignal,
  useRevokeGuardianLink,
  useSetAgeProfile,
} from '@/src/features/identity/api';
import { collectPlatformAgeSignal } from '@/src/features/identity/platform-age-native';
import type { AgeBand, GuardianInvitationDto, OnboardingStateDto } from '@/src/services/api/dtos';
import { apiOutbox } from '@/src/services/api/outbox';
import { toUserMessage } from '@/src/services/api/types';

const AGE_OPTIONS: { value: AgeBand; label: string; detail: string }[] = [
  { value: 'under_13', label: 'Menos de 13 anos', detail: 'O IA Aprova ainda não atende esta faixa.' },
  { value: '13_15', label: '13 a 15 anos', detail: 'Exige autorização de um responsável.' },
  { value: '16_17', label: '16 ou 17 anos', detail: 'Exige autorização de um responsável.' },
  { value: '18_plus', label: '18 anos ou mais', detail: 'Você conclui as etapas diretamente.' },
];

export default function IdentityOnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const query = useOnboardingState();
  const [editingAge, setEditingAge] = useState(false);

  if (query.isPending) return <PageState><LoadingState label="Verificando sua elegibilidade..." /></PageState>;
  if (query.isError || !query.data) return <PageState><ErrorState error={query.error} onRetry={() => void query.refetch()} /></PageState>;

  const state = query.data;
  let content: React.ReactNode;
  if (!state.configurationReady) content = <ConfigurationUnavailable />;
  else if (!state.ageBand || editingAge) content = <AgeStep current={state.ageBand} onDone={() => setEditingAge(false)} />;
  else if (state.ageBand === 'under_13') content = <UnderThirteen onCorrect={() => setEditingAge(true)} />;
  else if (state.platformAgeSignal.status === 'missing') content = <PlatformAgeStep />;
  else if (state.guardian.required && !state.guardian.verified) content = <MinorGuardianStep onCorrectAge={() => setEditingAge(true)} />;
  else if (!state.termsAccepted) content = <LegalStep kind="terms" state={state} />;
  else if (!state.privacyNoticeAcknowledged) content = <LegalStep kind="privacy" state={state} />;
  else content = <PreferencesStep state={state} onCorrectAge={() => setEditingAge(true)} />;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Text style={styles.brandMarkText}>IA</Text></View>
          <Text style={[styles.brandText, { color: colors.primary }]}>APROVA</Text>
        </View>
        {content}
        <OnboardingSignOutButton />
      </ScrollView>
    </View>
  );
}

function PlatformAgeStep() {
  const colors = useColors();

  return (
    <Section title="Confira a faixa com a loja" subtitle="Apple ou Google pode compartilhar somente uma faixa etária. O IA Aprova não recebe sua data de nascimento.">
      <View style={[styles.notice, { backgroundColor: colors.primaryLight, borderColor: '#BFDBFE' }]}>
        <Feather name="shield" size={22} color={colors.primary} />
        <Text style={[styles.noticeText, { color: colors.text }]}>A faixa informada por você continua separada deste sinal. Recusar ou não conseguir verificar mantém social e notificações desligados.</Text>
      </View>
      <PlatformAgeAction title="Consultar faixa na loja" size="lg" />
      <LegalLinks />
    </Section>
  );
}

function PlatformAgeAction({ title, size }: { title: string; size?: 'md' | 'lg' }) {
  const mutation = useReportPlatformAgeSignal();
  const [collecting, setCollecting] = useState(false);
  const collect = async () => {
    setCollecting(true);
    try {
      const report = await collectPlatformAgeSignal();
      if (!report) throw new Error('A verificação de faixa etária não está disponível nesta plataforma.');
      mutation.mutate(report);
    } catch (error) {
      Alert.alert('Verificação indisponível', toUserMessage(error));
    } finally {
      setCollecting(false);
    }
  };
  return (
    <>
      <AppButton title={title} onPress={() => void collect()} loading={collecting || mutation.isPending} fullWidth size={size} />
      {mutation.error ? <InlineError error={mutation.error} /> : null}
    </>
  );
}

function AgeStep({ current, onDone }: { current: AgeBand | null; onDone: () => void }) {
  const colors = useColors();
  const mutation = useSetAgeProfile();
  const [selected, setSelected] = useState<AgeBand | null>(current);
  const submit = () => {
    if (!selected) return;
    const run = () => mutation.mutate(selected, { onSuccess: onDone });
    if (current && selected !== current) {
      Alert.alert('Corrigir faixa etária?', 'A alteração desliga social e notificações e pode exigir nova autorização.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar correção', onPress: run },
      ]);
    } else run();
  };

  return (
    <Section title="Qual é a sua faixa etária?" subtitle="Informe somente a faixa. Não pedimos sua data de nascimento.">
      <View accessibilityRole="radiogroup" style={styles.options}>
        {AGE_OPTIONS.map((option) => {
          const checked = selected === option.value;
          return (
            <TouchableOpacity key={option.value} accessibilityRole="radio" accessibilityState={{ checked, disabled: mutation.isPending }} onPress={() => setSelected(option.value)} disabled={mutation.isPending} style={[styles.option, { borderColor: checked ? colors.primary : colors.border, backgroundColor: colors.white }]}>
              <View style={[styles.radio, { borderColor: checked ? colors.primary : colors.textLight }]}>{checked ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>
              <View style={styles.flex}><Text style={[styles.optionTitle, { color: colors.text }]}>{option.label}</Text><Text style={[styles.optionDetail, { color: colors.textSecondary }]}>{option.detail}</Text></View>
            </TouchableOpacity>
          );
        })}
      </View>
      {mutation.error ? <InlineError error={mutation.error} /> : null}
      <AppButton title="Confirmar faixa" onPress={submit} disabled={!selected} loading={mutation.isPending} fullWidth size="lg" />
      <AppButton title="Sou responsável e tenho um convite" onPress={() => router.push('/guardian/accept' as any)} variant="outline" fullWidth />
    </Section>
  );
}

function OnboardingSignOutButton() {
  const { signOut, userId } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const leave = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (userId) await apiOutbox.clearForOwnerId(userId);
    } finally {
      await signOut().catch(() => undefined);
      router.replace('/(auth)/login');
      setSigningOut(false);
    }
  };

  return (
    <AppButton
      title="Sair da conta"
      onPress={() => void leave()}
      variant="ghost"
      fullWidth
      loading={signingOut}
      accessibilityHint="Encerra a sessão e remove os dados pendentes desta conta deste dispositivo."
    />
  );
}

function UnderThirteen({ onCorrect }: { onCorrect: () => void }) {
  const colors = useColors();
  return (
    <Section title="Acesso indisponível para esta faixa" subtitle="Neste momento, o IA Aprova é destinado a pessoas com 13 anos ou mais.">
      <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }]}><Feather name="shield" size={22} color="#C2410C" /><Text style={[styles.noticeText, { color: colors.text }]}>Nenhuma área de estudo, simulado ou recurso social foi liberado para esta conta.</Text></View>
      <AppButton title="Corrigir faixa informada" onPress={onCorrect} variant="outline" fullWidth />
      <LegalLinks />
    </Section>
  );
}

function MinorGuardianStep({ onCorrectAge }: { onCorrectAge: () => void }) {
  const colors = useColors();
  const mutation = useCreateGuardianInvitation();
  const [invitation, setInvitation] = useState<GuardianInvitationDto | null>(null);
  const query = useOnboardingState();

  const shareInvitation = async () => {
    if (!invitation) return;
    await Share.share({ title: 'Convite de responsável do IA Aprova', message: `Use este código de uso único no IA Aprova: ${invitation.token}\nNão encaminhe para outras pessoas.` });
  };

  return (
    <Section title="Autorização do responsável" subtitle="Uma pessoa responsável, autenticada e com 18 anos ou mais deve concluir esta etapa.">
      <View style={[styles.notice, { backgroundColor: colors.primaryLight, borderColor: '#BFDBFE' }]}><Feather name="user-check" size={22} color={colors.primary} /><Text style={[styles.noticeText, { color: colors.text }]}>Não pedimos e-mail do responsável. Gere um código e envie por um canal de sua confiança.</Text></View>
      {!invitation ? <AppButton title="Gerar código de uso único" onPress={() => mutation.mutate(undefined, { onSuccess: setInvitation })} loading={mutation.isPending} fullWidth size="lg" /> : (
        <View style={[styles.tokenCard, { borderColor: colors.border, backgroundColor: colors.white }]}>
          <Text style={[styles.tokenLabel, { color: colors.textSecondary }]}>CÓDIGO SENSÍVEL · NÃO PUBLIQUE</Text>
          <Text selectable accessibilityLabel="Código de uso único do responsável" style={[styles.token, { color: colors.text }]}>{invitation.token}</Text>
          <Text style={[styles.helper, { color: colors.textSecondary }]}>Mantenha pressionado para copiar. Expira em {new Date(invitation.expiresAt).toLocaleString('pt-BR')}.</Text>
          <AppButton title="Compartilhar com segurança" onPress={() => void shareInvitation()} fullWidth />
        </View>
      )}
      {mutation.error ? <InlineError error={mutation.error} /> : null}
      <AppButton title="Verificar autorização" onPress={() => void query.refetch()} loading={query.isFetching} variant="outline" fullWidth />
      <AppButton title="Corrigir faixa etária" onPress={onCorrectAge} variant="ghost" fullWidth />
    </Section>
  );
}

function LegalStep({ kind, state }: { kind: 'terms' | 'privacy'; state: OnboardingStateDto }) {
  const colors = useColors();
  const mutation = useRecordLegalAcknowledgement();
  const [confirmed, setConfirmed] = useState(false);
  const isTerms = kind === 'terms';
  const version = isTerms ? state.requiredDocuments.termsVersion : state.requiredDocuments.privacyNoticeVersion;
  const url = isTerms ? EXTERNAL_LINKS.terms : EXTERNAL_LINKS.privacy;
  const title = isTerms ? 'Termos de Uso' : 'Aviso de Privacidade';
  useEffect(() => setConfirmed(false), [state.policyVersion, state.requiredDocuments.termsVersion, state.requiredDocuments.privacyNoticeVersion]);

  const snapshotReady = Boolean(
    state.policyVersion
    && state.requiredDocuments.termsVersion
    && state.requiredDocuments.privacyNoticeVersion,
  );
  const submit = () => {
    if (!state.policyVersion || !state.requiredDocuments.termsVersion || !state.requiredDocuments.privacyNoticeVersion) return;
    mutation.mutate({
      kind: isTerms ? 'terms_acceptance' : 'privacy_notice_acknowledgement',
      policyVersion: state.policyVersion,
      termsVersion: state.requiredDocuments.termsVersion,
      privacyNoticeVersion: state.requiredDocuments.privacyNoticeVersion,
    });
  };

  return (
    <Section title={isTerms ? 'Revise e aceite os Termos' : 'Reconheça o Aviso de Privacidade'} subtitle={isTerms ? 'A aceitação é obrigatória para usar o serviço.' : 'Este reconhecimento confirma a leitura; não é um consentimento genérico.'}>
      <TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={[styles.documentLink, { borderColor: colors.border, backgroundColor: colors.white }]}><Feather name="external-link" size={19} color={colors.primary} /><View style={styles.flex}><Text style={[styles.documentTitle, { color: colors.text }]}>Abrir {title}</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>Versão exigida: {version ?? 'indisponível'}</Text></View></TouchableOpacity>
      <CheckRow checked={confirmed} onPress={() => setConfirmed((value) => !value)} label={isTerms ? `Li e aceito os Termos de Uso, versão ${version ?? 'não informada'}.` : `Li e reconheço o Aviso de Privacidade, versão ${version ?? 'não informada'}.`} />
      {mutation.error ? <InlineError error={mutation.error} /> : null}
      <AppButton title={isTerms ? 'Aceitar Termos' : 'Registrar reconhecimento'} onPress={submit} disabled={!confirmed || !snapshotReady} loading={mutation.isPending} fullWidth size="lg" />
      <LegalLinks />
    </Section>
  );
}

function PreferencesStep({ state, onCorrectAge }: { state: OnboardingStateDto; onCorrectAge: () => void }) {
  const colors = useColors();
  const optional = useRecordOptionalConsent();
  const minor = state.ageBand === '13_15' || state.ageBand === '16_17';
  const learningBlockedByConflict = state.learning.reason === 'platform_age_signal_conflict';
  const platformGateBlocked = state.social.reason.startsWith('platform_age_signal_')
    || state.notifications.reason.startsWith('platform_age_signal_');

  return (
    <Section
      title={learningBlockedByConflict ? 'Revise sua faixa etária' : 'Identidade confirmada'}
      subtitle={learningBlockedByConflict ? 'A autodeclaração e a faixa compartilhada pela loja precisam ser compatíveis.' : 'Social e notificações são opcionais e permanecem desligados até uma autorização afirmativa.'}
    >
      {platformGateBlocked ? <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }]}><Feather name="lock" size={22} color="#C2410C" /><Text style={[styles.noticeText, { color: colors.text }]}>{learningBlockedByConflict ? 'A faixa compartilhada pela loja não corresponde à faixa informada. Corrija sua faixa ou consulte a loja novamente antes de estudar.' : 'O sinal da loja está ausente, indica menor ou ainda não possui prova do servidor. Por segurança, social e notificações ficam desligados.'}</Text></View> : null}
      {platformGateBlocked ? <PlatformAgeAction title="Consultar faixa novamente" /> : null}
      <PreferenceRow label="Recursos sociais" detail={minor ? 'Escolha definida pelo responsável.' : 'Amizades, ranking e duelos. Sem chat ou nome real.'} value={state.social.eligible} disabled={minor || platformGateBlocked || optional.isPending} onValueChange={(granted) => optional.mutate({ kind: 'social', granted })} />
      <PreferenceRow label="Notificações" detail={minor ? 'Escolha definida pelo responsável.' : 'Lembretes; a permissão do sistema será pedida somente depois.'} value={state.notifications.eligible} disabled={minor || platformGateBlocked || optional.isPending} onValueChange={(granted) => optional.mutate({ kind: 'notifications', granted })} />
      {optional.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {optional.error ? <InlineError error={optional.error} /> : null}
      <AppButton title={learningBlockedByConflict ? 'Revise a faixa para continuar' : 'Continuar para o IA Aprova'} onPress={() => router.replace('/(tabs)')} disabled={learningBlockedByConflict} fullWidth size="lg" />
      <AppButton title="Corrigir faixa etária" onPress={onCorrectAge} variant="ghost" fullWidth />
      <GuardianLinksPanel />
      <LegalLinks />
    </Section>
  );
}

function GuardianLinksPanel() {
  const colors = useColors();
  const linksQuery = useGuardianLinks();
  const revoke = useRevokeGuardianLink();
  const links = linksQuery.data?.links ?? [];
  const confirmRevoke = (linkId: string, counterpartPseudonym: string) => Alert.alert(
    'Revogar vínculo?',
    `O vínculo com ${counterpartPseudonym} será encerrado. Social e notificações do estudante serão desligados.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Revogar', style: 'destructive', onPress: () => revoke.mutate(linkId) },
    ],
  );

  if (linksQuery.isPending) return <ActivityIndicator accessibilityLabel="Carregando vínculos" color={colors.primary} />;
  if (linksQuery.isError) return <InlineError error={linksQuery.error} />;
  if (links.length === 0) return null;

  return (
    <View style={styles.guardianLinks}>
      <Text style={[styles.guardianLinksTitle, { color: colors.text }]}>Vínculos ativos</Text>
      <Text style={[styles.helper, { color: colors.textSecondary }]}>Identificações internas sem nome ou e-mail. Escolha exatamente qual vínculo deseja revogar.</Text>
      {links.map((link) => (
        <View key={link.linkId} style={[styles.guardianLinkCard, { borderColor: colors.border, backgroundColor: colors.white }]}>
          <View style={styles.flex}>
            <Text style={[styles.preferenceTitle, { color: colors.text }]}>{link.counterpartPseudonym}</Text>
            <Text style={[styles.helper, { color: colors.textSecondary }]}>{link.role === 'guardian' ? 'Você é o responsável neste vínculo.' : 'Você é o estudante neste vínculo.'}</Text>
          </View>
          <AppButton title="Revogar" onPress={() => confirmRevoke(link.linkId, link.counterpartPseudonym)} variant="danger" loading={revoke.isPending && revoke.variables === link.linkId} />
        </View>
      ))}
      {revoke.error ? <InlineError error={revoke.error} /> : null}
    </View>
  );
}

function ConfigurationUnavailable() {
  return <Section title="Configuração indisponível" subtitle="As versões jurídicas obrigatórias não foram configuradas no servidor. Nenhum recurso foi liberado."><LegalLinks /></Section>;
}

function PreferenceRow({ label, detail, value, disabled, onValueChange }: { label: string; detail: string; value: boolean; disabled: boolean; onValueChange: (value: boolean) => void }) {
  const colors = useColors();
  return <View style={[styles.preference, { borderColor: colors.border, backgroundColor: colors.white }]}><View style={styles.flex}><Text style={[styles.preferenceTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>{detail}</Text></View><Switch accessibilityLabel={label} accessibilityState={{ disabled }} value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ false: '#CBD5E1', true: '#93C5FD' }} thumbColor={value ? colors.primary : '#FFFFFF'} /></View>;
}

function CheckRow({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  const colors = useColors();
  return <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={[styles.checkRow, { borderColor: checked ? colors.primary : colors.border, backgroundColor: colors.white }]}><View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.textLight, backgroundColor: checked ? colors.primary : 'transparent' }]}>{checked ? <Feather name="check" size={15} color="#FFFFFF" /> : null}</View><Text style={[styles.checkLabel, { color: colors.text }]}>{label}</Text></TouchableOpacity>;
}

function LegalLinks() {
  const colors = useColors();
  return <Text style={[styles.legalLinks, { color: colors.textSecondary }]}>Consulte os <Text accessibilityRole="link" style={{ color: colors.primary, fontWeight: '800' }} onPress={() => void Linking.openURL(EXTERNAL_LINKS.terms)}>Termos de Uso</Text> e a <Text accessibilityRole="link" style={{ color: colors.primary, fontWeight: '800' }} onPress={() => void Linking.openURL(EXTERNAL_LINKS.privacy)}>Política de Privacidade</Text>.</Text>;
}

function InlineError({ error }: { error: unknown }) {
  const colors = useColors();
  return <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{toUserMessage(error)}</Text>;
}

function Section({ title, subtitle, children }: React.PropsWithChildren<{ title: string; subtitle: string }>) {
  const colors = useColors();
  return <View style={styles.section}><Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text><View style={styles.content}>{children}</View></View>;
}

function PageState({ children }: React.PropsWithChildren) { return <View style={styles.pageState}>{children}</View>; }

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flexGrow: 1, paddingHorizontal: 20 }, pageState: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }, brandMark: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, brandMarkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' }, brandText: { fontSize: 21, fontWeight: '900', letterSpacing: 0.5 },
  section: { width: '100%', maxWidth: 560, alignSelf: 'center' }, title: { fontSize: 27, lineHeight: 34, fontWeight: '900', textAlign: 'center' }, subtitle: { fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 8 }, content: { gap: 14, marginTop: 24 },
  options: { gap: 10 }, option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 16, padding: 14 }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 10, height: 10, borderRadius: 5 }, flex: { flex: 1 }, optionTitle: { fontSize: 15, fontWeight: '800' }, optionDetail: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: 16, padding: 15 }, noticeText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  tokenCard: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 10 }, tokenLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 }, token: { fontSize: 16, lineHeight: 24, fontWeight: '800' }, helper: { fontSize: 12, lineHeight: 18 },
  documentLink: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 }, documentTitle: { fontSize: 15, fontWeight: '800' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1.5, borderRadius: 16, padding: 15 }, checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, checkLabel: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  preference: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 15 }, preferenceTitle: { fontSize: 15, fontWeight: '800', marginBottom: 3 }, legalLinks: { fontSize: 12, lineHeight: 19, textAlign: 'center' }, error: { fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center' },
  guardianLinks: { gap: 10, marginTop: 6 }, guardianLinksTitle: { fontSize: 16, fontWeight: '900' }, guardianLinkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
});
