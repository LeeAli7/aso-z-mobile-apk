/**
 * ThinkingBlock — блок раздумий агента.
 *
 * БЕЗ статусов («Обдумывание завершено») и зелёных галочек.
 * Свёрнутая строка: иконка + «Раздумья». Клик открывает bottom-sheet
 * с текстом размышлений (как окно сессии снизу). Во время работы —
 * пульс + «…» + «Пропустить».
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

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

const DOT_DURATION = 480;

export function ThinkingBlock({ text, status, onSkip, onOpen, theme, bare }: Props) {
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

  const isThinking = status === "thinking";

  return (
    <View style={[styles.wrap, bare ? styles.wrapBare : null, { borderColor: !bare && isThinking ? theme.border : "rgba(255,255,255,0)" }]}>
      <Pressable
        onPress={() => text && !isThinking && onOpen?.()}
        disabled={isThinking || !text}
        accessibilityRole={text && !isThinking ? "button" : undefined}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: bare ? 0 : 10, paddingVertical: bare ? 4 : 8, opacity: pressed ? 0.8 : 1 }]}
        hitSlop={8}
      >
        {/* иконка: пульсация во время раздумий, статичная после */}
        <View style={[styles.iconBox, { backgroundColor: theme.surface2 }]}>
          {isThinking ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <MaterialIcons name="psychology" size={15} color={theme.dim} />
            </Animated.View>
          ) : (
            <MaterialIcons name="psychology" size={15} color={theme.dim} />
          )}
        </View>

        <Text style={{ color: theme.dim, fontSize: 12.5, fontWeight: "500", flexShrink: 1 }}>
          {isThinking ? "Обдумывание…" : "Раздумья"}
        </Text>

        {/* «дышащие» точки во время раздумий */}
        {isThinking && (
          <View style={{ flexDirection: "row", gap: 3, marginLeft: 4 }}>
            {[dotA, dotB, dotC].map((d, i) => (
              <Animated.View
                key={i}
                style={[{ width: 4, height: 4, borderRadius: 99, backgroundColor: theme.dim }, dotStyle(d)]}
              />
            ))}
          </View>
        )}

        {isThinking && onSkip && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onSkip(); }}
            hitSlop={8}
            style={[styles.skip, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.dim, fontSize: 10.5 }}>Пропустить</Text>
          </Pressable>
        )}
        {text && !isThinking && (
          <MaterialIcons name="chevron-right" size={16} color={theme.mute} />
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