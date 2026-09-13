import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface SelectFieldProps {
  label: string;
  value: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
}

export default function SelectField({ label, value, icon, onPress }: SelectFieldProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={[styles.field, { backgroundColor: colors.white, borderColor: colors.border }]}
      >
        {icon ? (
          <Feather name={icon} size={16} color={colors.primary} style={styles.leadingIcon} />
        ) : null}
        <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  leadingIcon: { marginRight: 8 },
  value: { flex: 1, fontSize: 14, fontWeight: '700' },
});
