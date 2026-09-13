import React from 'react';
import { Image, View, StyleSheet, ImageStyle, ViewStyle, ImageSourcePropType } from 'react-native';

type MascotType = 'aprovinho-tablet' | 'aprovinho-thumbs' | 'aprovinho-full' | 'aprobot-idea' | 'aprobot-thumbs';

const MASCOTS: Record<MascotType, ImageSourcePropType> = {
  'aprovinho-tablet': require('../assets/mascots/aprovinho-tablet-t.png'),
  'aprovinho-thumbs': require('../assets/mascots/aprovinho-thumbs.png'),
  'aprovinho-full': require('../assets/mascots/aprovinho-full.jpeg'),
  'aprobot-idea': require('../assets/mascots/aprobot-idea-t.png'),
  'aprobot-thumbs': require('../assets/mascots/aprobot-thumbs.jpeg'),
};

interface MascotProps {
  type: MascotType;
  width?: number;
  height?: number;
  style?: ViewStyle;
  imageStyle?: ImageStyle;
}

export default function Mascot({
  type,
  width = 100,
  height = 100,
  style,
  imageStyle,
}: MascotProps) {
  return (
    <View style={[{ width, height }, style]}>
      <Image
        source={MASCOTS[type]}
        style={[
          styles.image,
          { width, height },
          imageStyle,
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    flex: 1,
  },
});
