import { Redirect } from 'expo-router';

export default function LegacyOnboardingGoalRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
