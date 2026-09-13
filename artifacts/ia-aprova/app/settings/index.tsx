import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useColors } from '@/hooks/useColors';
import Header from '@/components/Header';
import AppCard from '@/components/AppCard';
import { EXTERNAL_LINKS } from '@/constants/links';
import { useApi } from '@/src/services/api/ApiProvider';
import { apiOutbox } from '@/src/services/api/outbox';
import { apiPaths } from '@/src/services/api/paths';
import { toUserMessage } from '@/src/services/api/types';

const FEEDBACK_EMAIL = 'suporte@iaaprova.com.br';

const SETTINGS_SECTIONS = [
  {
    title: 'Conta',
    items: [
      { id: 'edit_profile', label: 'Editar perfil', icon: 'user', type: 'nav' },
      { id: 'identity', label: 'Identidade e permissões', icon: 'shield', type: 'nav' },
      { id: 'guardian_invite', label: 'Autorizar um estudante', icon: 'user-check', type: 'nav' },
      { id: 'change_password', label: 'Alterar senha', icon: 'lock', type: 'nav' },
      { id: 'export_data', label: 'Exportar meus dados', icon: 'download', type: 'nav' },
      { id: 'delete_account', label: 'Excluir minha conta', icon: 'trash-2', type: 'nav' },
    ],
  },
  {
    title: 'Assinatura',
    items: [
      { id: 'plan', label: 'IA Aprova PRO', icon: 'star', type: 'nav', value: 'Conhecer' },
      { id: 'billing', label: 'Cobrança', icon: 'credit-card', type: 'nav' },
    ],
  },
  {
    title: 'Suporte',
    items: [
      { id: 'help', label: 'Central de Ajuda', icon: 'help-circle', type: 'nav' },
      { id: 'feedback', label: 'Enviar feedback', icon: 'message-square', type: 'nav' },
      { id: 'terms', label: 'Termos de Uso', icon: 'file-text', type: 'nav' },
      { id: 'privacy', label: 'Política de Privacidade', icon: 'shield', type: 'nav' },
      { id: 'version', label: 'Versão', icon: 'info', type: 'info', value: '' },
    ],
  },
];

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const { signOut, userId } = useAuth();
  const { client } = useApi();

  const openFeedback = async () => {
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Feedback IA Aprova')}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (ok) {
      Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert('Enviar feedback', `Escreva para ${FEEDBACK_EMAIL} e responderemos o quanto antes.`);
    }
  };

  const logout = async () => {
    try {
      if (userId) await apiOutbox.clearForOwnerId(userId);
    } finally {
      await signOut().catch(() => undefined);
      router.replace('/(auth)/login');
    }
  };

  const openExternal = async (url: string) => {
    const supported = await Linking.canOpenURL(url).catch(() => false);
    if (supported) await Linking.openURL(url);
    else Alert.alert('Não foi possível abrir o link', url);
  };

  const requestExport = async () => {
    try {
      await client.mutate(apiPaths.accountExport, { method: 'POST' });
      Alert.alert('Exportação solicitada', 'O pedido foi registrado. A entrega depende do processamento seguro no servidor.');
    } catch (error) {
      Alert.alert('Não foi possível solicitar', toUserMessage(error));
    }
  };

  const deleteAccount = () => {
    const subscriptionManagementUrl = Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions?package=br.com.iaaprova.app';
    Alert.alert(
      'Excluir conta permanentemente?',
      'Seu perfil, progresso e dados sociais serão excluídos conforme os prazos legais. Esta ação não pode ser desfeita e não cancela uma assinatura ativa na loja.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Gerenciar assinatura',
          onPress: () => void openExternal(subscriptionManagementUrl),
        },
        {
          text: 'Excluir minha conta',
          style: 'destructive',
          onPress: async () => {
            try {
              await client.mutate(apiPaths.account, { method: 'DELETE' });
              if (userId) {
                // The server request is already accepted at this point. Local
                // cleanup is best effort and must not turn a successful account
                // deletion into a misleading failure message.
                await Promise.allSettled([
                  apiOutbox.clearForOwnerId(userId),
                  AsyncStorage.multiRemove([
                    `ia_aprova_onboarding_v1:${userId}`,
                    `ia_aprova_stats_v1:${userId}`,
                    `ia_aprova_activity_v1:${userId}`,
                    `ia_aprova_settings_v1:${userId}`,
                  ]),
                ]);
              }
              await signOut().catch(() => undefined);
              router.replace('/(auth)/login');
            } catch (error) {
              Alert.alert('Não foi possível excluir', toUserMessage(error));
            }
          },
        },
      ],
    );
  };

  const handlePress = (id: string) => {
    switch (id) {
      case 'edit_profile':
        router.push('/profile/edit');
        break;
      case 'identity':
        router.push('/(onboarding)/identity' as any);
        break;
      case 'guardian_invite':
        router.push('/guardian/accept' as any);
        break;
      case 'change_password':
        Alert.alert('Alterar senha', 'Para redefinir sua senha, saia da conta e use "Esqueci minha senha" na tela de login.');
        break;
      case 'export_data':
        void requestExport();
        break;
      case 'delete_account':
        deleteAccount();
        break;
      case 'plan':
      case 'billing':
        router.push('/pro');
        break;
      case 'help':
        void openExternal(EXTERNAL_LINKS.help);
        break;
      case 'feedback':
        openFeedback();
        break;
      case 'terms':
        void openExternal(EXTERNAL_LINKS.terms);
        break;
      case 'privacy':
        void openExternal(EXTERNAL_LINKS.privacy);
        break;
      default:
        break;
    }
  };

  const getNavValue = (id: string, value?: string) => {
    if (id === 'version') return `${Constants.expoConfig?.version || '1.0.0'} (${Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || 1})`;
    return value;
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Header title="Configurações" showBack />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: isWeb ? 34 : insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* PRO upsell banner */}
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.9} onPress={() => router.push('/pro')} style={styles.proBanner}>
          <View style={[styles.proIcon, { backgroundColor: '#FEF3C7' }]}>
            <Feather name="star" size={18} color={colors.xpOrange} />
          </View>
          <View style={styles.proInfo}>
            <Text style={[styles.proTitle, { color: colors.text }]}>IA Aprova PRO</Text>
            <Text style={[styles.proSub, { color: colors.textSecondary }]}>Trilhas disponíveis, simulados e análises detalhadas</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textLight} />
        </TouchableOpacity>

        {SETTINGS_SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title.toUpperCase()}</Text>
            <AppCard radius={16} padding={0} noPadding>
              {section.items.map((item, i) => {
                const isLast = i === section.items.length - 1;
                const navValue = getNavValue(item.id, item.value);
                const rowStyle = [
                  styles.settingRow,
                  {
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: colors.border,
                  },
                ];
                const rowContent = (
                  <>
                    <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
                      <Feather name={item.icon as any} size={16} color={colors.primary} />
                    </View>
                    <Text style={[styles.settingLabel, { color: colors.text }]}>{item.label}</Text>

                    {item.type === 'nav' && (
                      <View style={styles.navRight}>
                        {navValue ? (
                          <Text style={[styles.navValue, { color: colors.textSecondary }]}>{navValue}</Text>
                        ) : null}
                        <Feather name="chevron-right" size={18} color={colors.textLight} />
                      </View>
                    )}
                    {item.type === 'info' && (
                      <Text style={[styles.infoValue, { color: colors.textLight }]}>{navValue}</Text>
                    )}
                  </>
                );

                if (item.type === 'nav') {
                  return (
                    <TouchableOpacity
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => handlePress(item.id)}
                      style={rowStyle}
                      activeOpacity={0.7}
                    >
                      {rowContent}
                    </TouchableOpacity>
                  );
                }
                return (
                  <View key={item.id} style={rowStyle}>
                    {rowContent}
                  </View>
                );
              })}
            </AppCard>
          </View>
        ))}

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: '#FEE2E2', backgroundColor: '#FEF2F2' }]}
          accessibilityRole="button"
          accessibilityLabel="Sair da conta"
          onPress={() => void logout()}
          activeOpacity={0.8}
        >
          <Feather name="log-out" size={18} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Sair da conta</Text>
        </TouchableOpacity>

        <Text style={[styles.appVersion, { color: colors.textLight }]}>
          IA Aprova v1.0.0 — Feito com dedicação para candidatos
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 8 },
  proBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#FDE68A', marginBottom: 4 },
  proIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  proInfo: { flex: 1, gap: 2 },
  proTitle: { fontSize: 15, fontWeight: '800' },
  proSub: { fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6, marginLeft: 4, marginTop: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navValue: { fontSize: 13, fontWeight: '500' },
  infoValue: { fontSize: 13, fontWeight: '500' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 99, paddingVertical: 14, marginTop: 8 },
  logoutText: { fontSize: 15, fontWeight: '700' },
  appVersion: { textAlign: 'center', fontSize: 12, fontWeight: '500', marginTop: 8 },
});
