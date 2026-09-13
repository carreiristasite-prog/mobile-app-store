import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppCard from '@/components/AppCard';
import { useDisplayName } from '@/hooks/useDisplayName';
import { useColors } from '@/hooks/useColors';
import { useBilling } from '@/src/services/billing/BillingProvider';
import { apiOutbox } from '@/src/services/api/outbox';

const MENU_ITEMS = [
  { icon: 'edit-2', label: 'Editar perfil', path: '/profile/edit' },
  { icon: 'bar-chart-2', label: 'Meu progresso', path: '/(tabs)/performance' },
  { icon: 'settings', label: 'Configurações e privacidade', path: '/settings' },
] as const;

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fullName, initials, avatarUri } = useDisplayName();
  const { signOut, userId } = useAuth();
  const billing = useBilling();
  const isPro = billing.entitlement?.active === true;
  const planLabel = billing.loading ? 'Verificando plano' : billing.error ? 'Plano indisponível' : isPro ? 'Plano Pro' : 'Plano Free';

  const logout = async () => {
    try {
      if (userId) await apiOutbox.clearForOwnerId(userId);
    } catch {
      // The provider will retry the namespaced purge after the session changes.
    } finally {
      await signOut().catch(() => undefined);
      router.replace('/(auth)/login');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 96 : insets.bottom + 88 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Perfil</Text>
        <AppCard radius={22} padding={20} style={styles.profileCard}>
          {avatarUri ? <Image source={{ uri: avatarUri }} style={styles.avatar} accessibilityLabel="Foto do perfil" /> : <View style={[styles.avatar, styles.initials, { backgroundColor: colors.primary }]}><Text style={styles.initialsText}>{initials}</Text></View>}
          <View style={styles.flex}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{fullName}</Text>
            <View style={[styles.plan, { backgroundColor: isPro ? '#FEF3C7' : colors.muted }]}><Feather name={isPro ? 'star' : billing.error ? 'alert-circle' : 'user'} size={12} color={isPro ? colors.xpOrange : colors.textSecondary} /><Text style={[styles.planText, { color: isPro ? colors.xpOrange : colors.textSecondary }]}>{planLabel}</Text></View>
          </View>
        </AppCard>

        {!billing.loading && !billing.error && !isPro ? <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/pro')} style={[styles.proCard, { backgroundColor: colors.primary }]}><View style={styles.flex}><Text style={styles.proTitle}>Conheça o Pro</Text><Text style={styles.proBody}>Veja benefícios e o preço confirmado pela sua loja.</Text></View><Feather name="chevron-right" size={21} color="#FFF" /></TouchableOpacity> : null}

        <AppCard radius={18} padding={0} noPadding>
          {MENU_ITEMS.map((item, index) => <TouchableOpacity key={item.label} accessibilityRole="button" onPress={() => router.push(item.path as any)} style={[styles.menu, { borderBottomColor: colors.border, borderBottomWidth: index === MENU_ITEMS.length - 1 ? 0 : 1 }]}><View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}><Feather name={item.icon} size={17} color={colors.primary} /></View><Text style={[styles.menuText, { color: colors.text }]}>{item.label}</Text><Feather name="chevron-right" size={18} color={colors.textLight} /></TouchableOpacity>)}
        </AppCard>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sair da conta" onPress={() => void logout()} style={[styles.logout, { borderColor: '#FECACA' }]}><Feather name="log-out" size={17} color={colors.error} /><Text style={[styles.logoutText, { color: colors.error }]}>Sair da conta</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { padding: 16, gap: 14 }, title: { fontSize: 28, fontWeight: '900', marginVertical: 6 }, profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14 }, avatar: { width: 68, height: 68, borderRadius: 99 }, initials: { alignItems: 'center', justifyContent: 'center' }, initialsText: { color: '#FFF', fontSize: 23, fontWeight: '900' }, flex: { flex: 1 }, name: { fontSize: 19, fontWeight: '900' }, plan: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 99, marginTop: 7 }, planText: { fontSize: 11, fontWeight: '800' }, proCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 18 }, proTitle: { color: '#FFF', fontSize: 16, fontWeight: '900' }, proBody: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 17, marginTop: 3 }, menu: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 }, menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, menuText: { flex: 1, fontSize: 14, fontWeight: '700' }, logout: { minHeight: 52, borderWidth: 1.5, borderRadius: 99, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, logoutText: { fontSize: 14, fontWeight: '800' },
});
