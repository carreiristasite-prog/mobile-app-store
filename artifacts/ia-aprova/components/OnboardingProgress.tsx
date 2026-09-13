import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface Props {
  step: number;
  total: number;
  onBack?: () => void;
}

export default function OnboardingProgress({ step, total, onBack }: Props) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backBtn} />
      )}
      <View style={styles.bars}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { backgroundColor: i < step ? colors.primary : colors.border },
            ]}
          />
        ))}
      </View>
      <View style={styles.backBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 6, borderRadius: 99 },
});
