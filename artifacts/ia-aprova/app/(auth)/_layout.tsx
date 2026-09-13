import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="splash" />
      <Stack.Screen name="login" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
