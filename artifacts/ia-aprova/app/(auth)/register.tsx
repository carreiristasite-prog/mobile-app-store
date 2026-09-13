import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignUp } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import AppButton from '@/components/AppButton';
import { EXTERNAL_LINKS } from '@/constants/links';

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  const { signUp, errors, fetchStatus } = useSignUp();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  const handleRegister = async () => {
    if (password !== confirm) return;

    const { error } = await signUp.password({
      emailAddress: email,
      password,
    });
    if (error) return;

    await signUp.update({ firstName: nome.split(' ')[0], lastName: nome.split(' ').slice(1).join(' ') || '' });
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code: verifyCode });
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          router.replace(decorateUrl('/(onboarding)/identity') as any);
        },
      });
    }
  };

  const emailError = errors?.fields?.emailAddress?.message;
  const passwordError = errors?.fields?.password?.message;
  const globalError = (errors?.global as any)?.[0]?.message ?? (errors?.global as any)?.message;
  const passwordMismatch = confirm && password !== confirm;

  if (
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0
  ) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingTop: isWeb ? 67 : insets.top + 32, paddingBottom: isWeb ? 34 : insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Verifique seu e-mail</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Enviamos um código de 6 digitos para {email}
          </Text>

          <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.white }]}>
            <Feather name="shield" size={18} color={colors.textLight} style={styles.inputIcon} />
            <TextInput
              placeholder="Código de verificação"
              placeholderTextColor={colors.textLight}
              value={verifyCode}
              onChangeText={setVerifyCode}
              style={[styles.input, { color: colors.text }]}
              keyboardType="numeric"
            />
          </View>
          {errors?.fields?.code?.message ? (
            <Text style={[styles.errorText, { color: colors.error }]}>{errors.fields.code.message}</Text>
          ) : null}

          <View nativeID="clerk-captcha" />

          <AppButton
            title={fetchStatus === 'fetching' ? 'Verificando...' : 'Confirmar cadastro'}
            onPress={handleVerify}
            fullWidth
            size="lg"
            disabled={!verifyCode || fetchStatus === 'fetching'}
          />
          <TouchableOpacity accessibilityRole="button" onPress={() => void signUp.verifications.sendEmailCode()} style={styles.resendRow}>
            <Text style={[styles.resendText, { color: colors.primary }]}>Reenviar código</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: isWeb ? 67 : insets.top + 16, paddingBottom: isWeb ? 34 : insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.text }]}>Vamos comecar!</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Crie sua conta para continuar.
        </Text>

        {globalError ? (
          <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
            <Feather name="alert-circle" size={15} color={colors.error} />
            <Text style={[styles.errorBoxText, { color: colors.error }]}>{globalError}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.white }]}>
            <Feather name="user" size={18} color={colors.textLight} style={styles.inputIcon} />
            <TextInput
              placeholder="Nome completo"
              placeholderTextColor={colors.textLight}
              value={nome}
              onChangeText={setNome}
              style={[styles.input, { color: colors.text }]}
            />
          </View>

          <View>
            <View style={[
              styles.inputWrap,
              { borderColor: emailError ? colors.error : colors.border, backgroundColor: colors.white },
            ]}>
              <Feather name="mail" size={18} color={colors.textLight} style={styles.inputIcon} />
              <TextInput
                placeholder="E-mail"
                placeholderTextColor={colors.textLight}
                value={email}
                onChangeText={setEmail}
                style={[styles.input, { color: colors.text }]}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            {emailError ? <Text style={[styles.errorText, { color: colors.error }]}>{emailError}</Text> : null}
          </View>

          <View>
            <View style={[
              styles.inputWrap,
              { borderColor: passwordError ? colors.error : colors.border, backgroundColor: colors.white },
            ]}>
              <Feather name="lock" size={18} color={colors.textLight} style={styles.inputIcon} />
              <TextInput
                placeholder="Senha (mínimo 8 caracteres)"
                placeholderTextColor={colors.textLight}
                value={password}
                onChangeText={setPassword}
                style={[styles.input, { color: colors.text }]}
                secureTextEntry={!showPass}
              />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPass ? 'Ocultar senha' : 'Mostrar senha'} onPress={() => setShowPass(!showPass)} style={styles.eyeBtn}>
                <Feather name={showPass ? 'eye-off' : 'eye'} size={18} color={colors.textLight} />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={[styles.errorText, { color: colors.error }]}>{passwordError}</Text> : null}
          </View>

          <View>
            <View style={[
              styles.inputWrap,
              { borderColor: passwordMismatch ? colors.error : colors.border, backgroundColor: colors.white },
            ]}>
              <Feather name="check-circle" size={18} color={colors.textLight} style={styles.inputIcon} />
              <TextInput
                placeholder="Confirmar senha"
                placeholderTextColor={colors.textLight}
                value={confirm}
                onChangeText={setConfirm}
                style={[styles.input, { color: colors.text }]}
                secureTextEntry={!showPass}
              />
            </View>
            {passwordMismatch ? (
              <Text style={[styles.errorText, { color: colors.error }]}>As senhas não coincidem</Text>
            ) : null}
          </View>

          <View accessibilityRole="summary" style={[styles.legalNotice, { backgroundColor: colors.primaryLight }]}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.termsText, { color: colors.textSecondary }]}>
              Depois de criar a conta, você revisará e aceitará os{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.terms)} style={[styles.termsLink, { color: colors.primary }]}>Termos de Uso</Text>
              {' '}e reconhecerá separadamente a{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.privacy)} style={[styles.termsLink, { color: colors.primary }]}>Política de Privacidade</Text>
              {' '}no fluxo versionado, antes de estudar.
            </Text>
          </View>

          <View nativeID="clerk-captcha" />

          <AppButton
            title={fetchStatus === 'fetching' ? 'Criando conta...' : 'Cadastrar'}
            onPress={handleRegister}
            fullWidth
            size="lg"
            disabled={!nome || !email || !password || !confirm || !!passwordMismatch || fetchStatus === 'fetching'}
          />
        </View>

        <View style={styles.loginRow}>
          <Text style={[styles.loginText, { color: colors.textSecondary }]}>Já tem conta? </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}>
            <Text style={[styles.loginLink, { color: colors.primary }]}>Entrar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 15, marginBottom: 24, lineHeight: 22 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  errorBoxText: { fontSize: 13, fontWeight: '500', flex: 1 },
  form: { gap: 12 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontWeight: '500' },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, fontWeight: '500', marginTop: 4, marginLeft: 4 },
  legalNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4, padding: 12, borderRadius: 12 },
  termsText: { flex: 1, fontSize: 13, lineHeight: 20 },
  termsLink: { fontWeight: '700' },
  loginRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  loginText: { fontSize: 14 },
  loginLink: { fontSize: 14, fontWeight: '700' },
  resendRow: { alignItems: 'center', marginTop: 16 },
  resendText: { fontSize: 14, fontWeight: '600' },
});
