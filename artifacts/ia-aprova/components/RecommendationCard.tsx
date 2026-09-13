import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface RecommendationCardProps {
  title: string;
  subtitle: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  iconColor: string;
  onPress?: () => void;
}

export default function RecommendationCard({
  title,
  subtitle,
  icon,
  color,
  iconColor,
  onPress,
}: RecommendationCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, { backgroundColor: colors.white }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color }]}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
        {subtitle}
      </Text>
      <View style={[styles.arrow, { backgroundColor: iconColor }]}>
        <Feather name="arrow-right" size={12} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 110,
    borderRadius: 20,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    gap: 6,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 14,
  },
  arrow: {
    width: 22,
    height: 22,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
