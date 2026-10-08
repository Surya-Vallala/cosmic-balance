import React from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { Libra } from '../cosmos';
import { colors, fonts, space } from '../theme';
import { Button, Screen, Wordmark } from '../ui';

export const CONTACT_EMAIL = 'tools@tesseractstudio.co';
export const APP_VERSION = '1.1';

const logo = require('../../assets/tesseract-logo-light.png');

export default function AboutScreen() {
  const email = () => {
    const subject = encodeURIComponent('Cosmic Balance: suggestion');
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}`).catch(() => {});
  };

  return (
    <Screen>
      <View style={s.hero}>
        <Libra width={180} />
        <View style={{ marginTop: space.xl }}>
          <Wordmark size={22} />
        </View>
        <Text style={s.lede}>Split bills with friends, anywhere on the planet, and keep everything in balance.</Text>
        <Text style={s.version}>Version {APP_VERSION}</Text>
      </View>

      <View style={s.block}>
        <Text style={s.kicker}>Developed by</Text>
        <Image
          source={logo}
          style={s.logo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Tesseract, Design and Build"
        />
        <Text style={s.body}>Tesseract Studio, Hyderabad</Text>
      </View>

      <View style={s.block}>
        <Text style={s.kicker}>Suggestions and questions</Text>
        <Text style={s.body}>Have an idea, found something wrong, or want to ask about the app? Write to us.</Text>
        <Text style={s.email} selectable>
          {CONTACT_EMAIL}
        </Text>
        <Button title="Email Tesseract Studio" variant="secondary" onPress={email} style={{ marginTop: space.md }} />
      </View>

      <Text style={s.foot}>The stars on the home screen are Libra, the constellation of the scales.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: space.lg, paddingBottom: space.xl },
  lede: { fontSize: 15, lineHeight: 22, color: colors.textSoft, textAlign: 'center', marginTop: space.md, maxWidth: 300 },
  version: { fontSize: 12, color: colors.muted, marginTop: space.sm },
  block: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.xl,
    marginTop: space.lg,
  },
  kicker: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: space.md },
  logo: { width: '100%', height: 52, maxWidth: 320 },
  body: { fontSize: 15, lineHeight: 22, color: colors.textSoft, marginTop: space.sm },
  email: { fontFamily: fonts.medium, fontSize: 16, color: colors.star, marginTop: space.sm },
  foot: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: space.xl },
});
