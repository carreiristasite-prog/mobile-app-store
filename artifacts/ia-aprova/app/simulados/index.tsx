import { Redirect } from 'expo-router';

/** Canonical entry point for simulations lives in the tab route. */
export default function SimuladosIndex() {
  return <Redirect href="/(tabs)/simulados" />;
}
