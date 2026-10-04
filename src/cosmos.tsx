// Minimal cosmic illustrations, drawn with thin lines and few marks:
// - Libra, the constellation of the scales (balance is what the app keeps)
// - a black hole, for empty screens
// - a pulsar, for loading and for sending reminders (a signal going out)
// - a supernova, for the moment a balance is settled
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';

const nativeDriver = Platform.OS !== 'web';

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => {});
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Libra

// Stars of Libra in a 100 × 70 box, brightest first, and the lines that join them.
const LIBRA_STARS: [number, number, number][] = [
  [62, 8, 2.4], // Zubeneschamali
  [22, 30, 2.2], // Zubenelgenubi
  [80, 36, 1.6], // Brachium
  [48, 44, 1.4], // Zubenelhakrabi
  [10, 58, 1.2], // Upsilon
  [70, 64, 1.1], // Tau
];
const LIBRA_LINES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [2, 5],
];

export function Libra({ width = 140, opacity = 1, style }: { width?: number; opacity?: number; style?: StyleProp<ViewStyle> }) {
  const height = (width * 70) / 100;
  return (
    <View pointerEvents="none" style={[{ width, height, opacity }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 100 70">
        {LIBRA_LINES.map(([a, b], i) => (
          <Line
            key={i}
            x1={LIBRA_STARS[a][0]}
            y1={LIBRA_STARS[a][1]}
            x2={LIBRA_STARS[b][0]}
            y2={LIBRA_STARS[b][1]}
            stroke={colors.text}
            strokeOpacity={0.22}
            strokeWidth={0.5}
          />
        ))}
        {LIBRA_STARS.map(([x, y, r], i) => (
          <G key={i}>
            <Circle cx={x} cy={y} r={r * 2.2} fill={colors.text} fillOpacity={0.06} />
            <Circle cx={x} cy={y} r={r * 0.75} fill={i === 0 ? colors.star : colors.text} fillOpacity={0.9} />
          </G>
        ))}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Black hole

/** An event horizon with a thin, tilted accretion disk wrapping around it. */
export function BlackHole({ size = 96 }: { size?: number }) {
  const c = 50;
  return (
    <View pointerEvents="none" style={{ width: size, height: size * 0.62 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size * 0.62} viewBox="0 18 100 62">
        <Defs>
          <RadialGradient id="bhGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0.45" stopColor={colors.star} stopOpacity={0.18} />
            <Stop offset="1" stopColor={colors.star} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={30} fill="url(#bhGlow)" />
        {/* back half of the disk */}
        <Path d="M 6 50 A 44 11 0 0 1 94 50" stroke={colors.star} strokeOpacity={0.35} strokeWidth={1.2} fill="none" />
        {/* photon ring and horizon */}
        <Circle cx={c} cy={c} r={16} fill="#020309" stroke={colors.star} strokeOpacity={0.9} strokeWidth={1} />
        {/* front half of the disk passes in front of the horizon */}
        <Path d="M 6 50 A 44 11 0 0 0 94 50" stroke={colors.star} strokeOpacity={0.85} strokeWidth={1.4} fill="none" />
        <Path d="M 20 52 A 30 6 0 0 0 80 52" stroke={colors.owe} strokeOpacity={0.35} strokeWidth={0.8} fill="none" />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pulsar

/** A neutron star sweeping two narrow beams. Turns slowly unless motion is reduced. */
export function Pulsar({ size = 40, spinning = true }: { size?: number; spinning?: boolean }) {
  const reduced = useReducedMotion();
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!spinning || reduced) return;
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: nativeDriver }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, reduced, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['-30deg', '330deg'] });
  return (
    <View pointerEvents="none" style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx={50} cy={50} r={30} stroke={colors.text} strokeOpacity={0.1} strokeWidth={1} fill="none" />
        <Circle cx={50} cy={50} r={44} stroke={colors.text} strokeOpacity={0.06} strokeWidth={1} fill="none" />
      </Svg>
      <Animated.View style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d="M 50 50 L 46 2 L 54 2 Z" fill={colors.star} fillOpacity={0.55} />
          <Path d="M 50 50 L 46 98 L 54 98 Z" fill={colors.star} fillOpacity={0.55} />
        </Svg>
      </Animated.View>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx={50} cy={50} r={9} fill={colors.star} fillOpacity={0.18} />
        <Circle cx={50} cy={50} r={4.5} fill={colors.text} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Supernova

const RAYS = [0, 28, 61, 90, 118, 152, 180, 209, 241, 270, 298, 331];

/**
 * A star's burst: a bright core, uneven rays and a thin shock ring.
 * With `burst`, it blooms once when it appears.
 */
export function Supernova({ size = 72, burst = false }: { size?: number; burst?: boolean }) {
  const reduced = useReducedMotion();
  const [grow] = useState(() => new Animated.Value(burst ? 0 : 1));
  useEffect(() => {
    if (!burst) return;
    if (reduced) {
      grow.setValue(1);
      return;
    }
    Animated.timing(grow, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [burst, reduced, grow]);
  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ width: size, height: size, opacity: grow, transform: [{ scale }] }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="snCore" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="0.35" stopColor={colors.star} stopOpacity={0.55} />
            <Stop offset="1" stopColor={colors.star} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={44} stroke={colors.owed} strokeOpacity={0.35} strokeWidth={0.8} fill="none" />
        {RAYS.map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const inner = 12;
          const outer = i % 3 === 0 ? 40 : i % 2 === 0 ? 30 : 22;
          return (
            <Line
              key={deg}
              x1={50 + inner * Math.cos(rad)}
              y1={50 + inner * Math.sin(rad)}
              x2={50 + outer * Math.cos(rad)}
              y2={50 + outer * Math.sin(rad)}
              stroke={colors.star}
              strokeOpacity={0.7}
              strokeWidth={0.9}
              strokeLinecap="round"
            />
          );
        })}
        <Circle cx={50} cy={50} r={18} fill="url(#snCore)" />
        <Ellipse cx={50} cy={50} rx={3} ry={3} fill="#FFFFFF" />
      </Svg>
    </Animated.View>
  );
}
