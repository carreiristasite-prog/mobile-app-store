import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import Header from '@/components/Header';
import AppCard from '@/components/AppCard';
import AppButton from '@/components/AppButton';

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const { user } = useUser();
  const [name, setName] = useState('');

  const clerkName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'Estudante';

  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const handleSave = async () => {
    if (!user) return;
    const trimmed = name.trim();
    const parts = trimmed.split(/\s+/).filter(Boolean);
    try {
      await user.update({
        firstName: parts[0] || user.firstName || undefined,
        lastName: parts.length > 1 ? parts.slice(1).join(' ') : user.lastName || undefined,
      });
      Alert.alert('Perfil atualizado', 'Seu nome foi salvo na conta. A Arena usa um pseudônimo separado.');
    } catch {
      Alert.alert('Não foi possível salvar', 'Tente novamente quando estiver conectado.');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Header title="Editar Perfil" showBack />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: isWeb ? 34 : insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <AppCard radius={20} padding={18} style={styles.card}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>COMO QUER QUE EU TE CHAME?</Text>
          <View style={[styles.inputBox, { backgroundColor: colors.white, borderColor: colors.border }]}>
            <Feather name="user" size={16} color={colors.textLight} />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Seu nome ou apelido"
              placeholderTextColor={colors.textLight}
              style={[styles.input, { color: colors.text }]}
              maxLength={30}
              returnKeyType="done"
            />
          </View>
          <Text style={[styles.hint, { color: colors.textLight }]}>
            Este nome fica associado à sua conta. O perfil da Arena usa um pseudônimo separado.
          </Text>
          <Text style={[styles.preview, { color: colors.textSecondary }]}>
            Prévia: <Text style={{ color: colors.text, fontWeight: '800' }}>{name.trim() || clerkName}</Text>
          </Text>
        </AppCard>

        {/* Account info + quick links */}
        <AppCard radius={20} padding={0} noPadding>
          {email && (
            <View style={[styles.linkRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <View style={[styles.linkIcon, { backgroundColor: colors.primaryLight }]}>
                <Feather name="mail" size={16} color={colors.primary} />
              </View>
              <View style={styles.linkInfo}>
                <Text style={[styles.linkLabel, { color: colors.textSecondary }]}>E-mail da conta</Text>
                <Text style={[styles.linkValue, { color: colors.text }]} numberOfLines={1}>{email}</Text>
              </View>
            </View>
          )}

        </AppCard>

        <AppButton
          title="Salvar"
          onPress={() => void handleSave()}
          fullWidth
          size="lg"
          icon={<Feather name="check" size={16} color="#FFFFFF" />}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { gap: 10 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  input: { flex: 1, fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17 },
  preview: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  linkIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  linkInfo: { flex: 1, gap: 2 },
  linkLabel: { fontSize: 11, fontWeight: '700' },
  linkValue: { fontSize: 14, fontWeight: '700' },
});
