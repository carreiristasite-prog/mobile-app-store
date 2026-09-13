import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useSignIn, useSSO } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import AppButton from '@/components/AppButton';
import AppleSignInButton from '@/components/AppleSignInButton';
import GoogleLogo from '@/components/GoogleLogo';
import { EXTERNAL_LINKS } from '@/constants/links';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'options' | 'email';
type VerificationStrategy = 'email_code' | 'phone_code' | 'totp' | 'backup_code';

function isVerificationStrategy(strategy: string): strategy is VerificationStrategy {
  return strategy === 'email_code'
    || strategy === 'phone_code'
    || strategy === 'totp'
    || strategy === 'backup_code';
}

function verificationStrategyLabel(strategy: VerificationStrategy): string {
  if (strategy === 'email_code') return 'E-mail';
  if (strategy === 'phone_code') return 'SMS';
  if (strategy === 'totp') return 'Autenticador';
  return 'Recuperação';
}

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<Mode>('options');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [verificationStrategy, setVerificationStrategy] = useState<VerificationStrategy | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const finalizeSignIn = async () => {
    await signIn.finalize({
      navigate: ({ decorateUrl }) => {
        router.replace(decorateUrl('/') as any);
      },
    });
  };

  const prepareVerification = async (strategy: VerificationStrategy) => {
    setVerificationError(null);
    setVerifyCode('');
    setVerificationStrategy(strategy);
    const result = strategy === 'email_code'
      ? await signIn.mfa.sendEmailCode()
      : strategy === 'phone_code'
        ? await signIn.mfa.sendPhoneCode()
        : { error: null };
    if (result.error) setVerificationError(result.error.message);
  };

  const handleLogin = async () => {
    setVerificationError(null);
    const { error: createError } = await signIn.create({ identifier: email.trim().toLowerCase() });
    if (createError) return;
    const { error } = await signIn.password({ password });
    if (error) return;

    if (signIn.status === 'complete') {
      await finalizeSignIn();
    } else if (signIn.status === 'needs_client_trust') {
      const strategies = signIn.supportedSecondFactors.map((factor) => factor.strategy);
      const preferred = strategies.includes('email_code')
        ? 'email_code'
        : strategies.includes('phone_code')
          ? 'phone_code'
          : null;
      if (preferred) {
        // Clerk does not send the trust challenge merely because the sign-in
        // changed state. Send it before claiming a code is waiting.
        await prepareVerification(preferred);
      } else if (strategies.includes('email_link')) {
        // Clerk does not support email-link verification in JavaScript custom
        // flows on native iOS/Android. The production instance must keep an
        // email or phone code enabled for Device Trust.
        setVerificationError('Esta conta exige verificação por link, que não está disponível neste aplicativo. Volte e use Google ou Apple para entrar.');
      } else {
        setVerificationError('Nenhum método compatível de verificação do dispositivo está disponível para esta conta.');
      }
    } else if (signIn.status === 'needs_second_factor') {
      const strategies = signIn.supportedSecondFactors.map((factor) => factor.strategy);
      const preferred = strategies.includes('phone_code')
        ? 'phone_code'
        : strategies.includes('totp')
          ? 'totp'
          : strategies.includes('backup_code')
            ? 'backup_code'
            : null;
      if (preferred) await prepareVerification(preferred);
      else setVerificationError('Nenhum segundo fator compatível está disponível para esta conta.');
    }
  };

  const handleVerify = async () => {
    setVerificationError(null);
    if (!verificationStrategy) {
      setVerificationError('Escolha um método de verificação compatível antes de continuar.');
      return;
    }
    const result = verificationStrategy === 'email_code'
      ? await signIn.mfa.verifyEmailCode({ code: verifyCode })
      : verificationStrategy === 'phone_code'
        ? await signIn.mfa.verifyPhoneCode({ code: verifyCode })
        : verificationStrategy === 'totp'
          ? await signIn.mfa.verifyTOTP({ code: verifyCode })
          : await signIn.mfa.verifyBackupCode({ code: verifyCode });
    if (result.error) {
      setVerificationError(result.error.message);
      return;
    }
    if (signIn.status === 'complete') {
      await finalizeSignIn();
    }
  };

  const handleSSO = useCallback(
    async (strategy: 'oauth_google', setLoading: (v: boolean) => void) => {
      try {
        setSocialError(null);
        setLoading(true);
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl: AuthSession.makeRedirectUri(),
        });
        if (createdSessionId) {
          await setActive!({
            session: createdSessionId,
            navigate: async ({ decorateUrl }) => {
              router.replace(decorateUrl('/') as any);
            },
          });
        }
      } catch (err) {
        setSocialError('Não foi possível concluir o login social. Tente novamente.');
        if (__DEV__) console.warn('Falha no login social.', err instanceof Error ? err.message : 'erro desconhecido');
      } finally {
        setLoading(false);
      }
    },
    [startSSOFlow],
  );

  const emailError = errors?.fields?.identifier?.message;
  const passwordError = errors?.fields?.password?.message;
  const globalError = (errors?.global as any)?.[0]?.message ?? (errors?.global as any)?.message;

  /* ─────────── MFA / email code verification ─────────── */
  if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
    const isCodeDelivery = verificationStrategy === 'email_code' || verificationStrategy === 'phone_code';
    const verificationTitle = verificationStrategy === null
      ? 'Verificação adicional necessária'
      : verificationStrategy === 'totp'
      ? 'Use seu autenticador'
      : verificationStrategy === 'backup_code'
        ? 'Use um código de recuperação'
        : verificationStrategy === 'phone_code'
          ? 'Verifique seu telefone'
          : 'Verifique seu e-mail';
    const verificationSubtitle = verificationStrategy === null
      ? 'Use um dos métodos compatíveis configurados para sua conta.'
      : verificationStrategy === 'totp'
      ? 'Digite o código exibido no seu aplicativo autenticador.'
      : verificationStrategy === 'backup_code'
        ? 'Digite um dos códigos de recuperação salvos quando o MFA foi configurado.'
        : verificationStrategy === 'phone_code'
          ? 'Enviamos um código para o telefone protegido da sua conta.'
          : `Enviamos um código de verificação para ${email}`;
    const availableStrategies = signIn.status === 'needs_second_factor'
      ? signIn.supportedSecondFactors
        .map((factor) => factor.strategy)
        .filter(isVerificationStrategy)
      : [];
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
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => signIn.reset()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{verificationTitle}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{verificationSubtitle}</Text>
          {availableStrategies.length > 1 ? (
            <View accessibilityRole="radiogroup" style={styles.factorRow}>
              {availableStrategies.map((strategy) => (
                <TouchableOpacity
                  key={strategy}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: verificationStrategy === strategy }}
                  onPress={() => void prepareVerification(strategy)}
                  style={[styles.factorButton, { borderColor: verificationStrategy === strategy ? colors.primary : colors.border }]}
                >
                  <Text style={[styles.factorText, { color: verificationStrategy === strategy ? colors.primary : colors.textSecondary }]}>
                    {verificationStrategyLabel(strategy)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {verificationStrategy ? (
            <>
              <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.white }]}>
                <Feather name="shield" size={18} color={colors.textLight} style={styles.inputIcon} />
                <TextInput
                  accessibilityLabel="Código de verificação"
                  placeholder="Código de verificação"
                  placeholderTextColor={colors.textLight}
                  value={verifyCode}
                  onChangeText={setVerifyCode}
                  style={[styles.input, { color: colors.text }]}
                  keyboardType={verificationStrategy === 'backup_code' ? 'default' : 'numeric'}
                  autoCapitalize="none"
                />
              </View>
              {errors?.fields?.code?.message ? (
                <Text style={[styles.errorText, { color: colors.error }]}>{errors.fields.code.message}</Text>
              ) : null}
            </>
          ) : null}
          {verificationError ? (
            <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error }]}>{verificationError}</Text>
          ) : null}
          {verificationStrategy ? (
            <AppButton
              title={fetchStatus === 'fetching' ? 'Verificando...' : 'Verificar'}
              onPress={handleVerify}
              fullWidth
              size="lg"
              disabled={!verifyCode || fetchStatus === 'fetching'}
            />
          ) : null}
          {isCodeDelivery && verificationStrategy ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => void prepareVerification(verificationStrategy)} style={styles.resendRow}>
              <Text style={[styles.resendText, { color: colors.primary }]}>Reenviar código</Text>
            </TouchableOpacity>
          ) : null}
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
          { paddingTop: isWeb ? 67 : insets.top + 24, paddingBottom: isWeb ? 34 : insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
            <Text style={styles.logoIA}>IA</Text>
          </View>
          <Text style={[styles.logoText, { color: colors.primary }]}>APROVA</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Bem-vindo ao IA Aprova</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Entre para continuar sua jornada rumo à aprovação.
        </Text>

        {globalError || socialError ? (
          <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
            <Feather name="alert-circle" size={15} color={colors.error} />
            <Text style={[styles.errorBoxText, { color: colors.error }]}>{socialError || globalError}</Text>
          </View>
        ) : null}

        {mode === 'options' ? (
          <>
            <View style={styles.form}>
              {/* Google */}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Entrar com Google"
                style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.white, opacity: googleLoading ? 0.7 : 1 }]}
                onPress={() => handleSSO('oauth_google', setGoogleLoading)}
                disabled={googleLoading}
                activeOpacity={0.85}
              >
                {googleLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <GoogleLogo size={20} />}
                <Text style={[styles.socialText, { color: colors.text }]}>Entrar com Google</Text>
              </TouchableOpacity>

              <AppleSignInButton
                disabled={appleLoading}
                onLoadingChange={setAppleLoading}
                onError={setSocialError}
              />

              {/* Email */}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Entrar com e-mail"
                style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.white }]}
                onPress={() => setMode('email')}
                activeOpacity={0.85}
              >
                <Feather name="mail" size={20} color={colors.primary} />
                <Text style={[styles.socialText, { color: colors.text }]}>Entrar com E-mail</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Criar conta"
                style={[styles.createBtn, { borderColor: colors.primary }]}
                onPress={() => router.push('/(auth)/register')}
                activeOpacity={0.85}
              >
                <Text style={[styles.createText, { color: colors.primary }]}>Criar Conta</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.termsText, { color: colors.textLight }]}>
              Consulte os{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.terms)} style={[styles.termsLink, { color: colors.primary }]}>Termos de Uso</Text>
              {' '}e{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(EXTERNAL_LINKS.privacy)} style={[styles.termsLink, { color: colors.primary }]}>Política de Privacidade</Text>.
            </Text>
          </>
        ) : (
          <View style={styles.form}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar às opções de login" onPress={() => setMode('options')} style={styles.inlineBack}>
              <Feather name="arrow-left" size={18} color={colors.textSecondary} />
              <Text style={[styles.inlineBackText, { color: colors.textSecondary }]}>Voltar</Text>
            </TouchableOpacity>

            <View>
              <View style={[
                styles.inputWrap,
                { borderColor: emailError ? colors.error : colors.border, backgroundColor: colors.white },
              ]}>
                <Feather name="mail" size={18} color={colors.textLight} style={styles.inputIcon} />
                <TextInput
                  accessibilityLabel="E-mail"
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
                  accessibilityLabel="Senha"
                  placeholder="Senha"
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

            <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(auth)/forgot-password')} style={styles.forgot}>
              <Text style={[styles.forgotText, { color: colors.primary }]}>Esqueci minha senha</Text>
            </TouchableOpacity>

            <AppButton
              title={fetchStatus === 'fetching' ? 'Entrando...' : 'Entrar'}
              onPress={handleLogin}
              fullWidth
              size="lg"
              disabled={!email || !password || fetchStatus === 'fetching'}
            />
          </View>
        )}

        <View style={styles.registerRow}>
          <Text style={[styles.registerText, { color: colors.textSecondary }]}>
            Nao tem conta?{' '}
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(auth)/register')}>
            <Text style={[styles.registerLink, { color: colors.primary }]}>Cadastre-se</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32, alignSelf: 'center' },
  logoBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoIA: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  logoText: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 28, lineHeight: 22 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  errorBoxText: { fontSize: 13, fontWeight: '500', flex: 1 },
  form: { gap: 12 },
  inlineBack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  inlineBackText: { fontSize: 14, fontWeight: '600' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontWeight: '500' },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, fontWeight: '500', marginTop: 4, marginLeft: 4 },
  forgot: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { fontSize: 13, fontWeight: '600' },
  socialBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, height: 54 },
  socialText: { fontSize: 15, fontWeight: '700' },
  createBtn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 14, height: 54, marginTop: 2 },
  createText: { fontSize: 15, fontWeight: '700' },
  termsText: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 20, paddingHorizontal: 8 },
  termsLink: { fontWeight: '700' },
  registerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  registerText: { fontSize: 14 },
  registerLink: { fontSize: 14, fontWeight: '700' },
  resendRow: { alignItems: 'center', marginTop: 16 },
  resendText: { fontSize: 14, fontWeight: '600' },
  factorRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  factorButton: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  factorText: { fontSize: 12, fontWeight: '700' },
});
