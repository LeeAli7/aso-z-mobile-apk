/**
 * Skeleton — пульсирующая заглушка загрузки (reanimated).
 */
import React, { useEffect } from "react";
import { DimensionValue, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useApp } from "../../store/AppStore";

export function Skeleton({ width, height, radius = 8, style }: { width?: DimensionValue; height: number; radius?: number; style?: ViewStyle }) {
  const { theme } = useApp();
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ width: width ?? "100%", height, borderRadius: radius, backgroundColor: theme.surface2 }, animated, style]}
    />
  );
}
