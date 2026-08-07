/**
 * ThinkingBlock — блок «Обдумывание…» в стиле Kimi.
 *
 * Паттерн Kimi (строки из APK):
 *   - thinking           = «Обдумывание…»   (идут раздумья, анимация)
 *   - thinking_done      = «Обдумывание завершено»
 *   - thinking_cancelled = «Обдумывание остановлено»
 *   - кнопка «Пропустить» (MESSAGE_LABEL_THINKING_SKIP) — сворачивает блок,
 *     генерация продолжается.
 *
 * Анимация: пульсирующая иконка + три «дышащие» точки (эквивалент
 * icon-k2thinking.riv на RN Animated — без тяжёлой Rive-библиотеки).
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

export type ThinkingStatus = "thinking" | "done" | "cancelled";

interface Props {
  /** Текст раздумий (reasoning_content), показывается при раскрытии. */
  text?: string;
  status: ThinkingStatus;
  /** Свернуть блок (Пропустить). */
  onSkip?: () => void;
  theme: any;
}

const DOT_DURATION = 480;

export function ThinkingBlock({ text, status, onSkip, theme }: Props) {
  const [open, setOpen] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const dotA = useRef(new Animated.Value(0)).current;
  const dotB = useRef(new Animated.Value(0)).current;
  const dotC = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== "thinking") return;
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    p.start();
    const mk = (v: Animated.Value, offset: number) => {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: DOT_DURATION, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: DOT_DURATION, easing: Easing.linear, useNativeDriver: true }),
        ]),
      );
      v.setValue(offset);
      l.start();
      return l;
    };
    const a = mk(dotA, 0);
    const b = mk(dotB, 0.33);
    const c = mk(dotC, 0.66);
    return () => {
      p.stop();
      a.stop();
      b.stop();
      c.stop();
    };
  }, [status, pulse, dotA, dotB, dotC]);

  const spin = pulse.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "18deg"] });
  const dotStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
  });

  const title =
    status === "done" ? "Обдумывание завершено" :
    status === "cancelled" ? "Обдумывание остановлено" : "Обдумывание…";

  const titleColor = status === "thinking" ? theme.dim : status === "done" ? theme.ok : theme.mute;

  return (
    <View style={[styles.wrap, { borderColor: status === "thinking" ? theme.border : "rgba(255,255,255,0)" }]}>
      <Pressable onPress={() => text && setOpen(!open)} style={styles.row} hitSlop={8}>
        {/* пульсирующая иконка */}
        <View style={[styles.iconBox, { backgroundColor: theme.accentDim }]}>
          {status === "thinking" ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <MaterialIcons name="psychology" size={15} color={theme.accentHi} />
            </Animated.View>
          ) : status === "done" ? (
            <MaterialIcons name="check" size={15} color={theme.ok} />
          ) : (
            <MaterialIcons name="close" size={15} color={theme.mute} />
          )}
        </View>

        <Text style={{ color: titleColor, fontSize: 12.5, fontWeight: "500", flexShrink: 1 }}>
          {title}
        </Text>

        {/* «дышащие» точки во время раздумий */}
        {status === "thinking" && (
          <View style={{ flexDirection: "row", gap: 3, marginLeft: 4 }}>
            {[dotA, dotB, dotC].map((d, i) => (
              <Animated.View
                key={i}
                style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.accentHi }, dotStyle(d)]}
              />
            ))}
          </View>
        )}

        {status === "thinking" && onSkip && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onSkip(); }}
            hitSlop={8}
            style={[styles.skip, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.dim, fontSize: 10.5 }}>Пропустить</Text>
          </Pressable>
        )}
        {text && status !== "thinking" && (
          <MaterialIcons name={open ? "expand-less" : "expand-more"} size={16} color={theme.mute} />
        )}
      </Pressable>

      {/* раздумья — моноширинный текст, сворачиваемый */}
      {open && text && (
        <Text selectable style={[styles.body, { color: theme.dim, backgroundColor: theme.surface2 }]}>
          {text.trim()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  skip: {
    marginLeft: "auto",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  body: {
    fontFamily: "monospace",
    fontSize: 11.5,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
