/**
 * PulseLoader — анимация загрузки в стиле «КРОВЬ».
 *
 * Форма взята с иконки приложения: белая капсула и красная точка внутри.
 * Пока идёт загрузка (старт приложения, подъём сессии, ожидание ответа
 * модели) красная точка медленно проходит капсулу из конца в конец и
 * пульсирует, а сама капсула едва дышит — как пульс по сосуду.
 *
 * Никаких спиннеров, градиентов и свечений: только две фигуры из иконки.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

export function PulseLoader({
  theme,
  scale = 1,
}: {
  theme: any;
  /** 1 — обычный (старт/сессия), 0.62 — мелкий (в чате, пока модель думает) */
  scale?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const W = 92 * scale;
  const H = 28 * scale;
  const dot = 8 * scale;
  const pad = 7 * scale;
  const travel = W - dot - pad * 2;
  // точка идёт вперёд-назад: 0 → 1 → 0 за один цикл
  const x = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, travel, 0] });
  // у краёв точка ускоряется и чуть растягивается, в середине — спокойна
  const dotScale = t.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [1.35, 1, 1.35, 1, 1.35],
  });
  const breathe = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.04, 1] });

  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 10 }}>
      <Animated.View
        style={{
          width: W,
          height: H,
          borderRadius: H / 2,
          backgroundColor: theme.text,
          justifyContent: "center",
          paddingHorizontal: pad,
          transform: [{ scale: breathe }],
        }}
      >
        <Animated.View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: theme.accent,
            transform: [{ translateX: x }, { scale: dotScale }],
          }}
        />
      </Animated.View>
    </View>
  );
}
