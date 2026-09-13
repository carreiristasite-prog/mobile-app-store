import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export interface SelectOption {
  label: string;
  value: string;
  desc?: string;
}

interface SelectSheetProps {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue: string;
  searchable?: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export default function SelectSheet({
  visible,
  title,
  options,
  selectedValue,
  searchable,
  onClose,
  onConfirm,
}: SelectSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [temp, setTemp] = useState(selectedValue);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setTemp(selectedValue);
      setQuery('');
    }
  }, [visible, selectedValue]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={[styles.sheet, { backgroundColor: colors.white, paddingBottom: insets.bottom + 14 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
            >
              <Feather name="x" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {searchable ? (
            <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Pesquisar"
                placeholderTextColor={colors.textLight}
                style={[styles.searchInput, { color: colors.text }]}
                autoCorrect={false}
              />
            </View>
          ) : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filtered.map((o) => {
              const active = o.value === temp;
              return (
                <TouchableOpacity
                  key={o.value}
                  onPress={() => setTemp(o.value)}
                  activeOpacity={0.7}
                  style={[
                    styles.option,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primaryLight : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.optTextWrap}>
                    <Text style={[styles.optLabel, { color: active ? colors.primaryDark : colors.text }]}>
                      {o.label}
                    </Text>
                    {o.desc ? (
                      <Text style={[styles.optDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                        {o.desc}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.radio, { borderColor: active ? colors.primary : colors.border }]}>
                    {active ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>Nenhum resultado encontrado</Text>
            ) : null}
          </ScrollView>

          <TouchableOpacity
            onPress={() => {
              onConfirm(temp);
              onClose();
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Confirmar seleção"
            style={[styles.confirm, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.confirmText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '82%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 99, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '500', padding: 0 },
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingBottom: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  optTextWrap: { flex: 1, gap: 2 },
  optLabel: { fontSize: 14, fontWeight: '700' },
  optDesc: { fontSize: 12, fontWeight: '500' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  empty: { textAlign: 'center', paddingVertical: 24, fontSize: 14, fontWeight: '500' },
  confirm: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
