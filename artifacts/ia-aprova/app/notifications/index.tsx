import { Redirect } from 'expo-router';

export default function LegacyNotificationsRedirect() {
  return <Redirect href="/(tabs)/profile" />;
}
