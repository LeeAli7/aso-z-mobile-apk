/**
 * Shimmer — серая полоска-заглушка с бегущим бликом.
 *
 * Стандартный приём загрузки: пока данных нет, вместо текста стоит
 * нейтральная плашка, по которой слева направо проходит мягкий блик.
 * Анимация живёт на UI-потоке (Reanimated), поэтому не грузит JS и не
 * дёргается при открытии панели.
 */
import React, { useEffect } from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export function Shimmer({
  w,
  h = 11,
  delay = 0,
  color,
  radius = 6,
  speed = 1150,
}: {
  w: number;
  h?: number;
  delay?: number;
  color: string;
  radius?: number;
  speed?: number;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: speed, easing: REasing.inOut(REasing.quad) }), -1, false),
    );
  }, [delay, p, speed]);

  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -w * 0.7 + p.value * (w * 1.7) }],
  }));

  return (
    <View style={{ width: w, height: h, borderRadius: radius, backgroundColor: color, overflow: "hidden" }}>
      <Reanimated.View style={[{ position: "absolute", top: 0, bottom: 0, width: Math.max(24, w * 0.6) }, band]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.075)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Reanimated.View>
    </View>
  );
}
