import { Redirect } from 'expo-router';

export default function LegacyOnboardingContestRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
