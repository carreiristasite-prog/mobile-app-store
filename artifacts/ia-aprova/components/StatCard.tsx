import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import AppCard from './AppCard';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: keyof typeof Feather.glyphMap;
  color?: string;
  suffix?: string;
}

export default function StatCard({ label, value, icon, color, suffix }: StatCardProps) {
  const colors = useColors();
  const accentColor = color ?? colors.primary;

  return (
    <AppCard style={styles.card} padding={14} radius={16}>
      {icon && (
        <View style={[styles.iconWrap, { backgroundColor: accentColor + '18' }]}>
          <Feather name={icon} size={16} color={accentColor} />
        </View>
      )}
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: accentColor }]}>
        {value}
        {suffix && <Text style={styles.suffix}>{suffix}</Text>}
      </Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  value: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  suffix: {
    fontSize: 14,
    fontWeight: '600',
  },
});
