import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/RemoteState';
import { EXTERNAL_LINKS } from '@/constants/links';
import { useColors } from '@/hooks/useColors';
import { useAcceptGuardianInvitation, useOnboardingState, useSetAgeProfile } from '@/src/features/identity/api';
import { toUserMessage } from '@/src/services/api/types';

export default function GuardianAcceptScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const stateQuery = useOnboardingState();
  const ageMutation = useSetAgeProfile();
  const acceptMutation = useAcceptGuardianInvitation();
  // Deliberately do not read this secret from route params/deep links. URLs,
  // navigation history and analytics are not an acceptable transport for a
  // one-use guardian token; the responsible adult must paste it explicitly.
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [responsibility, setResponsibility] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [social, setSocial] = useState(false);
  const [notifications, setNotifications] = useState(false);

  useEffect(() => {
    setResponsibility(false);
    setTerms(false);
    setPrivacy(false);
  }, [stateQuery.data?.policyVersion, stateQuery.data?.requiredDocuments.termsVersion, stateQuery.data?.requiredDocuments.privacyNoticeVersion]);

  if (stateQuery.isPending) return <PageState><LoadingState label="Verificando a conta do responsável..." /></PageState>;
  if (stateQuery.isError || !stateQuery.data) return <PageState><ErrorState error={stateQuery.error} onRetry={() => void stateQuery.refetch()} /></PageState>;
  const state = stateQuery.data;

  if (!state.configurationReady) {
    return <Page><Header /><Text style={[styles.title, { color: colors.text }]}>Aceite indisponível</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]}>As versões obrigatórias não estão configuradas no servidor. O convite não foi aceito.</Text></Page>;
  }

  if (state.ageBand !== '18_plus') {
    return (
      <Page>
        <Header />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Confirme que você é maior de idade</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{state.ageBand ? 'Esta conta está registrada em uma faixa menor de 18 anos e não pode atuar como responsável.' : 'Para analisar o convite, declare somente a faixa de 18 anos ou mais. Não pedimos data de nascimento.'}</Text>
        {!state.ageBand ? <AppButton title="Declaro ter 18 anos ou mais" onPress={() => ageMutation.mutate('18_plus')} loading={ageMutation.isPending} fullWidth size="lg" /> : null}
        {ageMutation.error ? <InlineError error={ageMutation.error} /> : null}
        <AppButton title="Voltar ao meu onboarding" onPress={() => router.replace('/(onboarding)/identity' as any)} variant="outline" fullWidth />
      </Page>
    );
  }

  if (acceptMutation.isSuccess) {
    return (
      <Page>
        <Header />
        <View accessibilityRole="alert" style={styles.success}><Feather name="check-circle" size={42} color={colors.success} /><Text style={[styles.title, { color: colors.text }]}>Autorização registrada</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]}>O estudante já pode verificar o estado no aparelho dele. As permissões escolhidas foram registradas pelo servidor.</Text></View>
        <AppButton title="Continuar na minha conta" onPress={() => router.replace('/(onboarding)/identity' as any)} fullWidth size="lg" />
      </Page>
    );
  }

  const canSubmit = Boolean(
    token.trim().length >= 40
    && responsibility
    && terms
    && privacy
    && state.policyVersion
    && state.requiredDocuments.termsVersion
    && state.requiredDocuments.privacyNoticeVersion,
  );
  const submit = () => {
    if (!state.policyVersion || !state.requiredDocuments.termsVersion || !state.requiredDocuments.privacyNoticeVersion) return;
    acceptMutation.mutate({
      token: token.trim(),
      acknowledgements: { responsibility: true, termsAccepted: true, privacyNoticeAcknowledged: true },
      permissions: { social, notifications },
      policyVersion: state.policyVersion,
      termsVersion: state.requiredDocuments.termsVersion,
      privacyNoticeVersion: state.requiredDocuments.privacyNoticeVersion,
    }, { onSuccess: () => setToken('') });
  };

  return (
    <Page>
      <Header />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Autorizar estudante</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>O código é de uso único. Não o publique nem o envie a terceiros.</Text>
      <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.white }]}>
        <TextInput accessibilityLabel="Código de uso único" placeholder="Cole o código do convite" placeholderTextColor={colors.textLight} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry={!showToken} style={[styles.input, { color: colors.text }]} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={showToken ? 'Ocultar código' : 'Mostrar código'} onPress={() => setShowToken((value) => !value)} style={styles.eye}><Feather name={showToken ? 'eye-off' : 'eye'} size={19} color={colors.textSecondary} /></TouchableOpacity>
      </View>

      <AckRow checked={responsibility} onPress={() => setResponsibility((value) => !value)} label={`Declaro ser a pessoa responsável e assumo a responsabilidade por esta autorização, versão ${state.policyVersion ?? 'indisponível'}.`} />
      <DocumentAck checked={terms} onPress={() => setTerms((value) => !value)} label={`Li e aceito os Termos de Uso, versão ${state.requiredDocuments.termsVersion ?? 'indisponível'}.`} url={EXTERNAL_LINKS.terms} linkLabel="Abrir Termos" />
      <DocumentAck checked={privacy} onPress={() => setPrivacy((value) => !value)} label={`Li e reconheço o Aviso de Privacidade, versão ${state.requiredDocuments.privacyNoticeVersion ?? 'indisponível'}.`} url={EXTERNAL_LINKS.privacy} linkLabel="Abrir Privacidade" />

      <Text style={[styles.optionalTitle, { color: colors.text }]}>Permissões opcionais do estudante</Text>
      <PermissionRow label="Social" detail="Amizades, ranking e duelos. Começa desligado." value={social} onValueChange={setSocial} />
      <PermissionRow label="Notificações" detail="Lembretes de estudo. Começa desligado." value={notifications} onValueChange={setNotifications} />

      {acceptMutation.error ? <InlineError error={acceptMutation.error} /> : null}
      <AppButton title="Confirmar autorização" onPress={submit} disabled={!canSubmit} loading={acceptMutation.isPending} fullWidth size="lg" />
      <Text style={[styles.footnote, { color: colors.textSecondary }]}>O IA Aprova não solicita e-mail do responsável neste fluxo.</Text>
    </Page>
  );
}

function Header() {
  const colors = useColors();
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={22} color={colors.text} /><Text style={[styles.backText, { color: colors.text }]}>Voltar</Text></TouchableOpacity>;
}

function DocumentAck({ checked, onPress, label, url, linkLabel }: { checked: boolean; onPress: () => void; label: string; url: string; linkLabel: string }) {
  const colors = useColors();
  return <View style={styles.documentGroup}><TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(url)}><Text style={[styles.documentLink, { color: colors.primary }]}>{linkLabel} <Feather name="external-link" size={13} color={colors.primary} /></Text></TouchableOpacity><AckRow checked={checked} onPress={onPress} label={label} /></View>;
}

function AckRow({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  const colors = useColors();
  return <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={[styles.ack, { borderColor: checked ? colors.primary : colors.border, backgroundColor: colors.white }]}><View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.textLight, backgroundColor: checked ? colors.primary : 'transparent' }]}>{checked ? <Feather name="check" size={15} color="#FFFFFF" /> : null}</View><Text style={[styles.ackText, { color: colors.text }]}>{label}</Text></TouchableOpacity>;
}

function PermissionRow({ label, detail, value, onValueChange }: { label: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const colors = useColors();
  return <View style={[styles.permission, { borderColor: colors.border, backgroundColor: colors.white }]}><View style={styles.flex}><Text style={[styles.permissionTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.permissionDetail, { color: colors.textSecondary }]}>{detail}</Text></View><Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{ false: '#CBD5E1', true: '#93C5FD' }} thumbColor={value ? colors.primary : '#FFFFFF'} /></View>;
}

function InlineError({ error }: { error: unknown }) { const colors = useColors(); return <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{toUserMessage(error)}</Text>; }
function PageState({ children }: React.PropsWithChildren) { return <View style={styles.pageState}>{children}</View>; }
function Page({ children }: React.PropsWithChildren) { const colors = useColors(); const insets = useSafeAreaInsets(); return <View style={[styles.root, { backgroundColor: colors.background }]}><ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">{children}</ScrollView></View>; }

const styles = StyleSheet.create({
  root: { flex: 1 }, pageState: { flex: 1, justifyContent: 'center', backgroundColor: '#F8FAFC' }, page: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, gap: 14 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }, backText: { fontSize: 14, fontWeight: '700' },
  title: { fontSize: 27, lineHeight: 34, fontWeight: '900', textAlign: 'center' }, subtitle: { fontSize: 15, lineHeight: 23, textAlign: 'center', marginBottom: 8 },
  inputWrap: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 15, paddingLeft: 14 }, input: { flex: 1, fontSize: 15 }, eye: { minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  ack: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1.5, borderRadius: 15, padding: 14 }, checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, ackText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  documentGroup: { gap: 7 }, documentLink: { fontSize: 13, fontWeight: '800', textAlign: 'right' }, optionalTitle: { fontSize: 16, fontWeight: '900', marginTop: 6 },
  permission: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 15, padding: 14 }, flex: { flex: 1 }, permissionTitle: { fontSize: 15, fontWeight: '800' }, permissionDetail: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  error: { fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center' }, footnote: { fontSize: 12, lineHeight: 18, textAlign: 'center' }, success: { alignItems: 'center', gap: 10, marginVertical: 30 },
});
