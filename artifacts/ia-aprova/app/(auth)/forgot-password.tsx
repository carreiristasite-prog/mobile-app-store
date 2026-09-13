import { useSignIn } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '@/components/AppButton';
import { useColors } from '@/hooks/useColors';

type Step = 'email' | 'code' | 'password' | 'success';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const loading = fetchStatus === 'fetching';

  const sendCode = async () => {
    setLocalError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setLocalError('Informe um e-mail válido.');
    const { error: createError } = await signIn.create({ identifier: email.trim().toLowerCase() });
    if (createError) return;
    const { error } = await signIn.resetPasswordEmailCode.sendCode();
    if (!error) setStep('code');
  };

  const verifyCode = async () => {
    setLocalError(null);
    if (code.trim().length < 6) return setLocalError('Informe o código recebido por e-mail.');
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (!error && signIn.status === 'needs_new_password') setStep('password');
  };

  const savePassword = async () => {
    setLocalError(null);
    if (password.length < 8) return setLocalError('Use uma senha com pelo menos 8 caracteres.');
    if (password !== confirm) return setLocalError('As senhas não coincidem.');
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
    if (error) return;
    if (signIn.status === 'needs_second_factor') {
      setLocalError('Sua conta exige verificação em duas etapas. Entre novamente para concluir.');
      return;
    }
    if (signIn.status === 'complete') {
      const { error: finalizeError } = await signIn.finalize({ navigate: async () => {} });
      if (!finalizeError) setStep('success');
    }
  };

  const clerkError = errors.fields.identifier?.message || errors.fields.code?.message || errors.fields.password?.message || (errors.global as any)?.[0]?.message;
  const message = localError || clerkError;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { paddingTop: Platform.OS === 'web' ? 48 : insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        {step !== 'success' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={22} color={colors.text} /></TouchableOpacity> : null}
        <View style={[styles.icon, { backgroundColor: colors.primaryLight }]}><Feather name={step === 'success' ? 'check' : 'lock'} size={28} color={step === 'success' ? colors.success : colors.primary} /></View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{step === 'email' ? 'Recuperar senha' : step === 'code' ? 'Verifique o código' : step === 'password' ? 'Crie uma nova senha' : 'Senha atualizada'}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{step === 'email' ? 'Enviaremos um código de segurança para seu e-mail.' : step === 'code' ? `Digite o código enviado para ${email}.` : step === 'password' ? 'A nova senha será aplicada e as outras sessões serão encerradas.' : 'Sua senha foi redefinida com segurança.'}</Text>

        {step === 'email' ? <Field icon="mail" placeholder="E-mail cadastrado" value={email} onChangeText={setEmail} keyboardType="email-address" /> : null}
        {step === 'code' ? <Field icon="shield" placeholder="Código de 6 dígitos" value={code} onChangeText={setCode} keyboardType="number-pad" /> : null}
        {step === 'password' ? <><Field icon="lock" placeholder="Nova senha" value={password} onChangeText={setPassword} secureTextEntry /><Field icon="check-circle" placeholder="Confirmar nova senha" value={confirm} onChangeText={setConfirm} secureTextEntry /></> : null}
        {message ? <View accessibilityRole="alert" style={styles.error}><Feather name="alert-circle" size={15} color={colors.error} /><Text style={[styles.errorText, { color: colors.error }]}>{message}</Text></View> : null}

        {step === 'email' ? <AppButton title="Enviar código" onPress={() => void sendCode()} loading={loading} fullWidth size="lg" /> : null}
        {step === 'code' ? <><AppButton title="Verificar código" onPress={() => void verifyCode()} loading={loading} disabled={!code} fullWidth size="lg" /><TouchableOpacity accessibilityRole="button" onPress={() => void sendCode()} style={styles.link}><Text style={[styles.linkText, { color: colors.primary }]}>Reenviar código</Text></TouchableOpacity></> : null}
        {step === 'password' ? <AppButton title="Salvar nova senha" onPress={() => void savePassword()} loading={loading} disabled={!password || !confirm} fullWidth size="lg" /> : null}
        {step === 'success' ? <AppButton title="Continuar" onPress={() => router.replace('/')} fullWidth size="lg" /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { icon: React.ComponentProps<typeof Feather>['name'] }) {
  const colors = useColors();
  const { icon, ...inputProps } = props;
  return <View style={[styles.field, { backgroundColor: colors.white, borderColor: colors.border }]}><Feather name={icon} size={18} color={colors.textLight} /><TextInput {...inputProps} accessibilityLabel={inputProps.accessibilityLabel || inputProps.placeholder} autoCapitalize="none" placeholderTextColor={colors.textLight} style={[styles.input, { color: colors.text }]} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, container: { flexGrow: 1, paddingHorizontal: 24, gap: 14 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, icon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, title: { fontSize: 25, fontWeight: '900', textAlign: 'center' }, subtitle: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 10 }, field: { flexDirection: 'row', alignItems: 'center', height: 54, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, gap: 10 }, input: { flex: 1, fontSize: 15 }, error: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FEF2F2' }, errorText: { flex: 1, fontSize: 13, lineHeight: 18 }, link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, linkText: { fontSize: 13, fontWeight: '700' },
});
