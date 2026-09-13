import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  Image,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ImageSourcePropType,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

const SLIDE_1 = require('@/assets/onboarding/slide-1.png');
const SLIDE_2 = require('@/assets/onboarding/slide-2.png');
const SLIDE_3 = require('@/assets/onboarding/slide-3.png');

const ONBOARDING_KEY = 'ia_aprova_onboarding_done';

const FOOTER_H = 110;
const TOP_PAD  = Platform.OS === 'web' ? 67 : 44;
const SLIDE_H  = height - FOOTER_H - TOP_PAD;

const SLIDES: { image: ImageSourcePropType; bg: string }[] = [
  { image: SLIDE_1, bg: '#EEF3FA' },
  { image: SLIDE_2, bg: '#F4F8FD' },
  { image: SLIDE_3, bg: '#0A1024' },
];

async function finishOnboarding() {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  router.replace('/(auth)/login');
}

export default function SplashScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex((prev) => (prev !== idx ? idx : prev));
  }, []);

  const goNext = () => {
    const next = activeIndex + 1;
    if (next >= SLIDES.length) {
      finishOnboarding();
    } else {
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
      setActiveIndex(next);
    }
  };

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.root}>
      {/* Skip */}
      <TouchableOpacity style={styles.skipBtn} onPress={finishOnboarding} activeOpacity={0.7}>
        <Text style={styles.skipText}>Pular</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        contentContainerStyle={{ height: SLIDE_H }}
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={[styles.slide, { width, height: SLIDE_H, backgroundColor: s.bg }]}>
            <Image source={s.image} style={styles.slideImage} resizeMode="contain" />
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { height: FOOTER_H }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                scrollRef.current?.scrollTo({ x: i * width, animated: true });
                setActiveIndex(i);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.dot, activeIndex === i && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.ctaBtn, isLast ? styles.ctaBtnDark : styles.ctaBtnBlue]}
          onPress={goNext}
          activeOpacity={0.85}
        >
          {isLast ? (
            <Text style={styles.ctaBtnText}>Começar minha jornada</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.ctaBtnText}>Continuar</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: TOP_PAD,
  },

  skipBtn: {
    position: 'absolute',
    top: TOP_PAD + 14,
    right: 18,
    zIndex: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(15,23,42,0.32)',
  },
  skipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  slide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideImage: {
    width: '100%',
    height: '100%',
  },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 18,
    paddingTop: 10,
    gap: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#CBD5E1',
  },
  dotActive: {
    width: 28,
    backgroundColor: '#1D5DFF',
  },
  ctaBtn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnBlue: { backgroundColor: '#1D5DFF' },
  ctaBtnDark: { backgroundColor: '#0E2F7A' },
  ctaBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
