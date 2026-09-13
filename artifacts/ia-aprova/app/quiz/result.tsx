import { Redirect } from 'expo-router';

export default function LegacyQuizResultRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
