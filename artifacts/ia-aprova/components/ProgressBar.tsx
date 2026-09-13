import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  trackColor?: string;
  height?: number;
  showLabel?: boolean;
  radius?: number;
}

export default function ProgressBar({
  value,
  max = 100,
  color,
  trackColor,
  height = 8,
  showLabel = false,
  radius = 99,
}: ProgressBarProps) {
  const colors = useColors();
  const pct = Math.min(Math.max(value / max, 0), 1);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.track,
          {
            height,
            borderRadius: radius,
            backgroundColor: trackColor ?? '#E2E8F0',
          },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${pct * 100}%`,
              borderRadius: radius,
              backgroundColor: color ?? colors.primary,
            },
          ]}
        />
      </View>
      {showLabel && (
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {Math.round(pct * 100)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  track: {
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
});
