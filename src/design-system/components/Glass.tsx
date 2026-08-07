/**
 * Glass — глэссморфизм (стекло) поверх настоящего backdrop-blur (expo-blur).
 *
 * Суть именно глэсса: полупрозрачный блюр-фон + тонкая светлая рамка +
 * внутренний top-highlight (блик сверху) + мягкая тень. Работает и в тёмной,
 * и в светлой теме. На web — backdrop-filter, на Android/iOS — BlurView.
 *
 * Используем БЕЗ параметра React = не заворачиваем каждый раз в отдельный
 * компонент-обёртку: `tint` берём из темы, блюр в меру (больше → молочное
 * стекло; меньше → чистое).
 */
import React from "react";
import { StyleSheet, View, ViewStyle, Pressable, TextStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useApp } from "../../store/AppStore";

/** Возвращает стеклянные стили обёртки (рамка, блик, тень). */
export function glassStyle(theme: any, radius: number): ViewStyle {
  return {
    borderRadius: radius,
    borderWidth: 1,
    borderColor: theme.name === "dark" ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.7)",
    backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.5)",
    // верхний блик + мягкая тень (глэм-фирменные) — тень теперь заметнее
    shadowColor: "#000",
    shadowOpacity: theme.name === "dark" ? 0.5 : 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    overflow: "hidden",
  };
}

/**
 * Стеклянная карточка: BlurView-подложка + содержимое поверх.
 * Тint: тёмная тема → тёмное стекло, светлая → светлое.
 */
export function Glass({
  radius = 22,
  intensity = 38,
  style,
  children,
}: {
  radius?: number;
  intensity?: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const { theme } = useApp();
  const tint = theme.name === "dark" ? "dark" : "light";
  return (
    <BlurView
      intensity={intensity}
      tint={tint}
      style={[glassStyle(theme, radius), { borderRadius: radius }, style]}
    >
      {children}
    </BlurView>
  );
}

/**
 * Стеклянная кликабельная кнопка-капсула (круг/пилюля).
 * За морфизм отвечает BlurView-подложка; pressed-затемнение на pressable.
 */
export function GlassPressable({
  onPress,
  radius = 22,
  intensity = 38,
  style,
  pressedStyle,
  disabled,
  children,
  accessibilityLabel,
}: {
  onPress?: () => void;
  radius?: number;
  intensity?: number;
  style?: ViewStyle;
  /** стиль в нажатом состоянии (например, акцентная рамка/тень) */
  pressedStyle?: ViewStyle;
  disabled?: boolean;
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const { theme } = useApp();
  const tint = theme.name === "dark" ? "dark" : "light";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          borderRadius: radius,
          borderWidth: 1,
          borderColor: theme.name === "dark" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.55)",
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: pressed ? 0.18 : 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 5,
          opacity: disabled ? 0.4 : 1,
        },
        style,
        pressed ? pressedStyle : null,
      ]}
    >
      <BlurView intensity={intensity} tint={tint} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius }} />
      <View style={{ borderRadius: radius, overflow: "hidden" }}>{children}</View>
    </Pressable>
  );
}