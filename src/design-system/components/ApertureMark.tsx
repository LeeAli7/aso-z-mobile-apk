/**
 * Знак Aso — диафрагма из шести лепестков.
 *
 * Один path на лепесток, сетка 24, внешний диаметр 20.6, отверстие 12.2,
 * зазор 1.4. Анимация живёт не на повороте (знак шестикратно симметричен —
 * вращение не видно), а на очереди лепестков: они загораются по кругу.
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Svg, Path } from "react-native-svg";

const BLADES = [
  "M12.72 1.73 L13.38 1.79 L14.04 1.90 L14.69 2.06 L15.33 2.25 L15.95 2.49 L16.56 2.77 L17.15 3.08 L17.72 3.43 L18.26 3.82 L18.78 4.24 L19.27 4.70 L19.72 5.18 L20.15 5.70 L20.54 6.24 L17.80 10.11 L17.67 9.74 L17.51 9.38 L17.33 9.03 L17.12 8.69 L16.90 8.37 L16.65 8.06 L16.39 7.76 L16.10 7.49 L15.80 7.23 L15.49 6.99 L15.15 6.78 L14.81 6.59 L14.45 6.42 L14.09 6.27 Z",
  "M21.26 7.48 L21.53 8.09 L21.76 8.72 L21.96 9.36 L22.11 10.01 L22.21 10.67 L22.28 11.33 L22.30 12.00 L22.28 12.67 L22.21 13.33 L22.11 13.99 L21.96 14.64 L21.76 15.28 L21.53 15.91 L21.26 16.52 L16.53 16.08 L16.79 15.78 L17.02 15.46 L17.24 15.13 L17.43 14.78 L17.60 14.43 L17.74 14.06 L17.86 13.68 L17.96 13.30 L18.03 12.91 L18.08 12.52 L18.10 12.12 L18.09 11.73 L18.06 11.33 L18.01 10.94 Z",
  "M20.54 17.76 L20.15 18.30 L19.72 18.82 L19.27 19.30 L18.78 19.76 L18.26 20.18 L17.72 20.57 L17.15 20.92 L16.56 21.23 L15.95 21.51 L15.33 21.75 L14.69 21.94 L14.04 22.10 L13.38 22.21 L12.72 22.27 L10.73 17.97 L11.12 18.04 L11.51 18.08 L11.91 18.10 L12.30 18.09 L12.70 18.06 L13.09 18.00 L13.48 17.92 L13.86 17.81 L14.23 17.68 L14.59 17.52 L14.94 17.34 L15.28 17.14 L15.61 16.92 L15.92 16.67 Z",
  "M11.28 22.27 L10.62 22.21 L9.96 22.10 L9.31 21.94 L8.67 21.75 L8.05 21.51 L7.44 21.23 L6.85 20.92 L6.28 20.57 L5.74 20.18 L5.22 19.76 L4.73 19.30 L4.28 18.82 L3.85 18.30 L3.46 17.76 L6.20 13.89 L6.33 14.26 L6.49 14.62 L6.67 14.97 L6.88 15.31 L7.10 15.63 L7.35 15.94 L7.61 16.24 L7.90 16.51 L8.20 16.77 L8.51 17.01 L8.85 17.22 L9.19 17.41 L9.55 17.58 L9.91 17.73 Z",
  "M2.74 16.52 L2.47 15.91 L2.24 15.28 L2.04 14.64 L1.89 13.99 L1.79 13.33 L1.72 12.67 L1.70 12.00 L1.72 11.33 L1.79 10.67 L1.89 10.01 L2.04 9.36 L2.24 8.72 L2.47 8.09 L2.74 7.48 L7.47 7.92 L7.21 8.22 L6.98 8.54 L6.76 8.87 L6.57 9.22 L6.40 9.57 L6.26 9.94 L6.14 10.32 L6.04 10.70 L5.97 11.09 L5.92 11.48 L5.90 11.88 L5.91 12.27 L5.94 12.67 L5.99 13.06 Z",
  "M3.46 6.24 L3.85 5.70 L4.28 5.18 L4.73 4.70 L5.22 4.24 L5.74 3.82 L6.28 3.43 L6.85 3.08 L7.44 2.77 L8.05 2.49 L8.67 2.25 L9.31 2.06 L9.96 1.90 L10.62 1.79 L11.28 1.73 L13.27 6.03 L12.88 5.96 L12.49 5.92 L12.09 5.90 L11.70 5.91 L11.30 5.94 L10.91 6.00 L10.52 6.08 L10.14 6.19 L9.77 6.32 L9.41 6.48 L9.06 6.66 L8.72 6.86 L8.39 7.08 L8.08 7.33 Z",
];

type MarkProps = {
  size: number;
  color?: string;
  /** непрозрачность каждого лепестка, 6 значений 0..1 */
  bladeOpacity?: number[];
};

/** Статичный знак. */
export function ApertureMark({ size, color = "#EDEDEF", bladeOpacity }: MarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {BLADES.map((d, i) => (
        <Path key={i} d={d} fill={color} opacity={bladeOpacity ? bladeOpacity[i] : 1} />
      ))}
    </Svg>
  );
}

function OneBlade({ d, size, color, v }: { d: string; size: number; color: string; v: SharedValue<number> }) {
  const st = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, st]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={d} fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** Очередь лепестков — индикатор работы без вращения и без точек. */
export function ApertureSpin({
  size,
  color = "#8A8A91",
  cycle = 1080,
  min = 0.22,
}: {
  size: number;
  color?: string;
  cycle?: number;
  min?: number;
}) {
  const a = useSharedValue(min);
  const b = useSharedValue(min);
  const c = useSharedValue(min);
  const d1 = useSharedValue(min);
  const e = useSharedValue(min);
  const f = useSharedValue(min);
  const vals = [a, b, c, d1, e, f];

  useEffect(() => {
    vals.forEach((v, i) => {
      v.value = withDelay(
        i * (cycle / 6),
        withRepeat(
          withSequence(
            withTiming(1, { duration: cycle / 2, easing: Easing.inOut(Easing.cubic) }),
            withTiming(min, { duration: cycle / 2, easing: Easing.inOut(Easing.cubic) }),
          ),
          -1,
          false,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, min]);

  return (
    <View style={{ width: size, height: size }}>
      {BLADES.map((d, i) => (
        <OneBlade key={i} d={d} size={size} color={color} v={vals[i]} />
      ))}
    </View>
  );
}

/** Одноразовое появление: створки встают по одной. */
export function ApertureReveal({
  size,
  color = "#EDEDEF",
  step = 70,
  dur = 260,
  onDone,
}: {
  size: number;
  color?: string;
  step?: number;
  dur?: number;
  onDone?: () => void;
}) {
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);
  const d1 = useSharedValue(0);
  const e = useSharedValue(0);
  const f = useSharedValue(0);
  const vals = [a, b, c, d1, e, f];

  useEffect(() => {
    vals.forEach((v, i) => {
      v.value = withDelay(i * step, withTiming(1, { duration: dur, easing: Easing.out(Easing.cubic) }));
    });
    const id = setTimeout(() => onDone?.(), 5 * step + dur);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ width: size, height: size }}>
      {BLADES.map((d, i) => (
        <OneBlade key={i} d={d} size={size} color={color} v={vals[i]} />
      ))}
    </View>
  );
}
