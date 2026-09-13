import { useAuth } from '@clerk/expo';
import { Tabs, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';
import NetworkStatusBanner from '@/components/NetworkStatusBanner';

function TabIcon({
  name,
  color,
  size = 22,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  color: ColorValue;
  size?: number;
}) {
  return <Feather name={name} size={size} color={color} />;
}

export default function TabLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const colors = useColors();
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/splash" />;

  return (
    <View style={styles.root}>
      <NetworkStatusBanner />
      <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#94A3B8',
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#F1F5F9',
          elevation: 0,
          height: isWeb ? 84 : 72,
          paddingBottom: isWeb ? 34 : 8,
          paddingTop: 6,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }]} />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hoje',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="questions"
        options={{
          title: 'Questões',
          tabBarIcon: ({ color }) => <TabIcon name="book-open" color={color} />,
        }}
      />
      <Tabs.Screen
        name="simulados"
        options={{
          title: 'Simulados',
          tabBarIcon: ({ color }) => <TabIcon name="clipboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: 'Progresso',
          tabBarIcon: ({ color }) => <TabIcon name="bar-chart-2" color={color} />,
        }}
      />
      <Tabs.Screen
        name="review"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="duelo"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="ranking"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <TabIcon name="user" color={color} />,
        }}
      />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
