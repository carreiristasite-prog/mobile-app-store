import { Redirect } from 'expo-router';

export default function LegacyOnboardingBuildingRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
