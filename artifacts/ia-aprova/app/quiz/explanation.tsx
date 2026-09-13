import { Redirect } from 'expo-router';

export default function LegacyQuizExplanationRedirect() {
  return <Redirect href="/(tabs)/questions" />;
}
