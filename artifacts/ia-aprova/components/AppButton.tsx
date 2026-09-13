import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
  icon,
  accessibilityLabel,
  accessibilityHint,
}: AppButtonProps) {
  const colors = useColors();

  const getBgColor = () => {
    if (disabled) return '#CBD5E1';
    switch (variant) {
      case 'primary': return colors.primary;
      case 'secondary': return colors.primaryLight;
      case 'outline': return 'transparent';
      case 'ghost': return 'transparent';
      case 'danger': return colors.error;
      default: return colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return '#94A3B8';
    switch (variant) {
      case 'primary': return '#FFFFFF';
      case 'secondary': return colors.primary;
      case 'outline': return colors.primary;
      case 'ghost': return colors.primary;
      case 'danger': return '#FFFFFF';
      default: return '#FFFFFF';
    }
  };

  const getPadding = () => {
    switch (size) {
      case 'sm': return { paddingVertical: 8, paddingHorizontal: 16 };
      case 'md': return { paddingVertical: 13, paddingHorizontal: 24 };
      case 'lg': return { paddingVertical: 16, paddingHorizontal: 32 };
    }
  };

  const getFontSize = () => {
    switch (size) {
      case 'sm': return 13;
      case 'md': return 15;
      case 'lg': return 16;
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      activeOpacity={0.85}
      disabled={disabled || loading}
      style={[
        styles.btn,
        {
          backgroundColor: getBgColor(),
          borderColor: variant === 'outline' ? colors.primary : 'transparent',
          borderWidth: variant === 'outline' ? 1.5 : 0,
          ...getPadding(),
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <Text
            style={[
              styles.text,
              {
                color: getTextColor(),
                fontSize: getFontSize(),
              },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1D5DFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  icon: {
    marginRight: 2,
  },
});
