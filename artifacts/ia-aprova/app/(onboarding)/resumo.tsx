import { Redirect } from 'expo-router';

export default function LegacyOnboardingSummaryRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
