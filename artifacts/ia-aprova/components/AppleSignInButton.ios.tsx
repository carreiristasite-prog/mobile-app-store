import { useSignInWithApple } from '@clerk/expo/apple';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import React from 'react';
import type { AppleSignInButtonProps } from './AppleSignInButton.types';

type NativeAuthError = Error & { code?: string };

export default function AppleSignInButton({
  disabled,
  onLoadingChange,
  onError,
}: AppleSignInButtonProps) {
  const { startAppleAuthenticationFlow } = useSignInWithApple();

  const signIn = async () => {
    if (disabled) return;
    try {
      onError(null);
      onLoadingChange(true);
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (!createdSessionId || !setActive) {
        throw new Error('A Apple não retornou uma sessão válida.');
      }
      await setActive({ session: createdSessionId });
      router.replace('/');
    } catch (error) {
      const authError = error as NativeAuthError;
      if (authError.code !== 'ERR_REQUEST_CANCELED') {
        onError('Não foi possível entrar com a Apple. Tente novamente.');
        if (__DEV__) console.warn('Falha no login nativo Apple.', authError.message);
      }
    } finally {
      onLoadingChange(false);
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      accessibilityLabel="Entrar com Apple"
      accessibilityState={{ disabled: Boolean(disabled) }}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      cornerRadius={14}
      onPress={() => void signIn()}
      style={{ width: '100%', height: 54, opacity: disabled ? 0.7 : 1 }}
    />
  );
}
