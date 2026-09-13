import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

type XPBarProps = {
  current: number;
  next?: number;
  label?: string;
  showValues?: boolean;
};

export default function XPBar({ current, next = 100, label = 'XP', showValues = true }: XPBarProps) {
  const colors = useColors();
  const safeNext = Math.max(next, 1);
  const progress = Math.min(Math.max(current / safeNext, 0), 1);
  return (
    <View accessible accessibilityLabel={`${label}: ${current} de ${safeNext} XP`} style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {showValues ? <Text style={[styles.value, { color: colors.textSecondary }]}>{current}/{safeNext}</Text> : null}
      </View>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.xpOrange }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '800' },
  value: { fontSize: 12, fontWeight: '700' },
  track: { height: 9, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },
});
