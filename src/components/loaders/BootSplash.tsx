/**
 * BootSplash — старт приложения.
 *
 * Чёрный экран с анимацией «AI thought burst»: капсула заряжается, сжимается
 * и в момент вспышки разлетается на частицы — ровно в этот кадр чёрный
 * растворяется и под ним проявляется интерфейс. То есть переход в приложение
 * происходит вместе со взрывом, а не после него.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { PillBurstLoader } from "./PillBurstLoader";

type Props = {
  /** вызывается после того, как шторка растворилась */
  onDone: () => void;
  /** задержка перед началом перехода, мс (по умолчанию — первый взрыв) */
  holdMs?: number;
};

export function BootSplash({ onDone, holdMs = 0 }: Props) {
  const opacity = useSharedValue(1);
  const fired = useRef(false);
  const [visible, setVisible] = useState(true);

  const start = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    const go = () => {
      opacity.value = withTiming(0, {
        duration: 340,
        easing: Easing.out(Easing.cubic),
      });
      setTimeout(() => {
        setVisible(false);
        onDone();
      }, 350);
    };
    if (holdMs > 0) setTimeout(go, holdMs);
    else go();
  }, [holdMs, onDone, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // страховка: если анимация почему-то не отдала вспышку — не держим чёрный экран
  useEffect(() => {
    const id = setTimeout(start, 3600);
    return () => clearTimeout(id);
  }, [start]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: "#000", zIndex: 999 }, fade]}
    >
      <View style={styles.center}>
        <PillBurstLoader size={1.05} onBurst={start} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
