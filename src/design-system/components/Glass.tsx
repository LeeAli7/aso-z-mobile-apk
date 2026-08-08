/**
 * Glass — глэссморфизм (стекло) БЕЗ нативного BlurView.
 *
 * ПОЧЕМУ НЕ BlurView: на Android expo-blur рендерится отдельным нативным
 * слоем — перехватывает тачи (TextInput не работает), ломает размеры
 * кнопок, режет иконки, в ScrollView/Sheet даёт артефакты. На web без
 * подложки blur'у нечего размывать — стекло не видно.
 *
 * РЕШЕНИЕ: стекло рисуется примитивами — полупрозрачный фон + тонкая
 * светлая рамка + верхний блик (внутренний highlight) + мягкая тень.
 * Поверх фоновых glow-пятен (GlassBackdrop) это выглядит как матовое
 * стекло и работает одинаково на Android / iOS / web. Без нативных
 * слоёв: тачи, размеры и иконки ведут себя предсказуемо.
 */
import React from "react";
import { StyleSheet, View, ViewStyle, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { useApp } from "../../store/AppStore";

/** Стеклянные стили (фон, рамка, блик, тень) — используются всеми компонентами. */
export function glassStyle(theme: any, radius: number): ViewStyle {
  const dark = theme.name === "dark";
  return {
    borderRadius: radius,
    borderWidth: 1,
    borderColor: dark ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.75)",
    backgroundColor: dark ? "rgba(20,20,24,.55)" : "rgba(255,255,255,.52)",
    // внутренний верхний блик — имитация света на стекле
    borderTopWidth: 1.5,
    shadowColor: "#000",
    shadowOpacity: dark ? 0.5 : 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  };
}

/** Стеклянная карточка-контейнер (некликабельная). */
export function Glass({
  radius = 22,
  style,
  children,
  blur = true,
}: {
  radius?: number;
  style?: ViewStyle;
  children: React.ReactNode;
  blur?: boolean;
}) {
  const { theme } = useApp();
  return (
    <View style={[glassStyle(theme, radius), { borderRadius: radius, overflow: "hidden" }, style]}>
      {blur && (
        <BlurView
          intensity={26}
          tint={theme.name === "dark" ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {children}
    </View>
  );
}

/** Стеклянная кликабельная кнопка-капсула (круг/пилюля). */
export function GlassPressable({
  onPress,
  radius = 22,
  style,
  pressedStyle,
  disabled,
  children,
  accessibilityLabel,
  blur = true,
}: {
  onPress?: () => void;
  radius?: number;
  style?: ViewStyle;
  pressedStyle?: ViewStyle;
  disabled?: boolean;
  children: React.ReactNode;
  accessibilityLabel?: string;
  blur?: boolean;
}) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        glassStyle(theme, radius),
        {
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: pressed ? 0.8 : disabled ? 0.4 : 1,
        },
        style,
        pressed ? pressedStyle : null,
      ]}
    >
      {blur && (
        <BlurView
          intensity={26}
          tint={theme.name === "dark" ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {children}
    </Pressable>
  );
}

/** Экспорт StyleSheet для совместимости. */
export { StyleSheet, View };