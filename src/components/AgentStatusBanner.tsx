/**
 * AgentStatusBanner — in-app виджет «агент активен».
 *
 * Узкая плашка под шапкой чата: пульс-точка + статус + таймер + кнопка Стоп.
 * Видна только пока идёт стриминг. Движок не тронут: visible/onStop/status —
 * контракт из ChatScreen (isStreaming + abort уже там).
 *
 * NATIVE OWNER (Арес/Марсель): persistent notification в шторке
 * (foreground-service + expo-notifications) — отдельный нативный модуль,
 * сейчас без новых зависимостей; этот баннер — in-app часть виджета.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";

export function AgentStatusBanner({
  visible,
  theme,
  status,
  stopLabel,
  onStop,
}: {
  visible: boolean;
  theme: any;
  status: string;
  stopLabel: string;
  onStop: () => void;
}) {
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0.35)).current;
  const [sec, setSec] = useState(0);

  useEffect(() => {
    if (!visible) {
      setSec(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    const iv = setInterval(() => setSec((s) => s + 1), 1000);
    return () => {
      loop.stop();
      clearInterval(iv);
    };
  }, [visible, pulse]);

  if (!visible) return null;

  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 52, left: 12, right: 12, zIndex: 19 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.ok, opacity: pulse }} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 12.5, fontWeight: "600" }}>
          {status} · {mm}:{ss}
        </Text>
        <Pressable
          onPress={onStop}
          hitSlop={8}
          android_ripple={{ color: theme.ripple }}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: theme.danger + "22" }}
          accessibilityLabel={stopLabel}
          accessibilityRole="button"
        >
          <AppIcon name="stop" size={13} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 12, fontWeight: "700" }}>{stopLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
