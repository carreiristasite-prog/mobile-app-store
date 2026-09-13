import { Redirect } from 'expo-router';

export default function LegacyOnboardingDiagnosticRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
