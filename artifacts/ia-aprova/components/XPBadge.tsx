import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface XPBadgeProps {
  rank: string;
  backgroundColor?: string;
  textColor?: string;
  iconColor?: string;
  size?: 'sm' | 'md';
}

export default function XPBadge({
  rank,
  backgroundColor = '#FFF3D6',
  textColor = '#C9800A',
  iconColor = '#C9800A',
  size = 'md',
}: XPBadgeProps) {
  const isSm = size === 'sm';
  return (
    <View style={[styles.badge, { backgroundColor, paddingVertical: isSm ? 3 : 4, paddingHorizontal: isSm ? 6 : 8 }]}>
      <Feather name="award" size={isSm ? 10 : 12} color={iconColor} />
      <Text style={[styles.text, { color: textColor, fontSize: isSm ? 10 : 11 }]}>{rank}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 9999,
  },
  text: {
    fontWeight: '800',
  },
});
