import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export type TabConfig = {
  name: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
};

export const TAB_CONFIG: TabConfig[] = [
  { name: 'index', label: 'Hoje', icon: 'home' },
  { name: 'questions', label: 'Questões', icon: 'book-open' },
  { name: 'simulados', label: 'Simulados', icon: 'clipboard' },
  { name: 'performance', label: 'Progresso', icon: 'bar-chart-2' },
  { name: 'profile', label: 'Perfil', icon: 'user' },
];

interface BottomTabsProps {
  activeTab: string;
  onTabPress: (name: string) => void;
}

export default function BottomTabs({ activeTab, onTabPress }: BottomTabsProps) {
  const colors = useColors();
  return (
    <View style={[styles.container, { borderTopColor: colors.border, backgroundColor: colors.white }]}>
      {TAB_CONFIG.map((tab) => {
        const active = activeTab === tab.name;
        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => onTabPress(tab.name)}
            activeOpacity={0.75}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <Feather name={tab.icon} size={22} color={active ? colors.primary : '#94A3B8'} />
            <Text style={[styles.label, { color: active ? colors.primary : '#94A3B8' }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 6,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
  },
});
