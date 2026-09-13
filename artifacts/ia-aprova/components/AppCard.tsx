import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';

interface AppCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  radius?: number;
  noPadding?: boolean;
}

export default function AppCard({
  children,
  style,
  padding = 16,
  radius = 20,
  noPadding = false,
}: AppCardProps) {
  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: radius,
          padding: noPadding ? 0 : padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
});
