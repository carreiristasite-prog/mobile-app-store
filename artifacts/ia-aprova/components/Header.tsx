import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  showLogo?: boolean;
  rightAction?: React.ReactNode;
  onBack?: () => void;
  transparent?: boolean;
}

export default function Header({
  title,
  showBack = false,
  showLogo = false,
  rightAction,
  onBack,
  transparent = false,
}: HeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const topInset = isWeb ? 67 : insets.top;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: topInset + 12,
          backgroundColor: transparent ? 'transparent' : colors.white,
          borderBottomColor: transparent ? 'transparent' : colors.border,
          borderBottomWidth: transparent ? 0 : 1,
        },
      ]}
    >
      <View style={styles.inner}>
        {showBack ? (
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}

        {showLogo ? (
          <View style={styles.logo}>
            <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
              <Text style={styles.logoIconText}>IA</Text>
            </View>
            <Text style={[styles.logoText, { color: colors.primary }]}>APROVA</Text>
          </View>
        ) : (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title ?? ''}
          </Text>
        )}

        {rightAction ? (
          <View style={styles.rightAction}>{rightAction}</View>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    width: 36,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIconText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  rightAction: {
    width: 36,
    alignItems: 'flex-end',
  },
});
