import { Redirect } from 'expo-router';

export default function LegacyContestRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
