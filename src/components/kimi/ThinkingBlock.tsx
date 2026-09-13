/**
 * ThinkingBlock — блок раздумий агента.
 *
 * Во время работы — только анимация (три дышащие точки, вариант A),
 * без текста «Думаю» и без иконки. После — иконка-лампа + шеврон
 * (тап открывает sheet с текстом размышлений). Зелёных галочек нет.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon } from "../../design-system/components/AppIcon";

export type ThinkingStatus = "thinking" | "done" | "cancelled";

interface Props {
  /** Текст раздумий (reasoning_content) — показывается в sheet по клику. */
  text?: string;
  status: ThinkingStatus;
  /** Свернуть блок (Пропустить). */
  onSkip?: () => void;
  /** Открыть sheet с раздумьями. */
  onOpen?: () => void;
  theme: any;
  /** Голый режим: без рамки/фона — строка внутри единого блока цепочки. */
  bare?: boolean;
}

export function ThinkingBlock({ text, status, onSkip, onOpen, theme, bare }: Props) {
  // три дышащие точки (вариант A): opacity + scale, каскад 0/.18/.36с
  const d0 = useRef(new Animated.Value(0)).current;
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== "thinking") return;
    const beat = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay(560 - delay),
        ]),
      );
    const loops = [beat(d0, 0), beat(d1, 180), beat(d2, 360)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [status, d0, d1, d2]);

  const isThinking = status === "thinking";

  const dot = (v: Animated.Value) => {
    const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
    const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
    return (
      <Animated.View
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          backgroundColor: theme.accentHi,
          opacity,
          transform: [{ scale }],
        }}
      />
    );
  };

  // во время работы — только точки, без текста и иконки
  if (isThinking) {
    return (
      <View style={[styles.wrap, bare ? styles.wrapBare : null, { borderColor: "transparent" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: bare ? 0 : 10, paddingVertical: bare ? 8 : 10 }}>
          {dot(d0)}
          {dot(d1)}
          {dot(d2)}
          {onSkip && (
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); onSkip(); }}
              hitSlop={8}
              style={[styles.skip, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.dim, fontSize: 10.5 }}>Пропустить</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, bare ? styles.wrapBare : null, { borderColor: "transparent" }]}>
      <Pressable
        onPress={() => text && onOpen?.()}
        disabled={!text}
        accessibilityRole={text ? "button" : undefined}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: bare ? 0 : 10, paddingVertical: bare ? 4 : 8, opacity: pressed ? 0.8 : 1 }]}
        hitSlop={8}
      >
        {/* статичная лампа после завершения */}
        <View style={[styles.iconBox, { backgroundColor: theme.surface2 }]}>
          <AppIcon name="bulb" size={15} color={theme.dim} />
        </View>
        {text && (
          <AppIcon name="chevron-right" size={16} color={theme.mute} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  wrapBare: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  skip: {
    marginLeft: "auto",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});