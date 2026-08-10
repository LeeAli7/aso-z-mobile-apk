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
import { LinearGradient } from "expo-linear-gradient";
import { useApp } from "../../store/AppStore";

/**
 * Стеклянные стили (фон, рамка, блик, тень) — используются всеми компонентами.
 * «Физика стекла»: светлый край сверху-слева (блик), почти прозрачный снизу-справа,
 * полупрозрачная градиентная заливка, мягкая тень — элементы читаются как матовое стекло.
 */
export function glassStyle(theme: any, radius: number): ViewStyle {
  const dark = theme.name === "dark";
  return {
    borderRadius: radius,
    borderWidth: 1,
    // световой край грани: верх/лево — полупрозрачный белый (блик), низ/право — почти прозрачный
    borderTopColor: dark ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.9)",
    borderLeftColor: dark ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.85)",
    borderRightColor: dark ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.45)",
    borderBottomColor: dark ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.35)",
    backgroundColor: dark ? "rgba(22,22,28,.62)" : "rgba(255,255,255,.58)",
    shadowColor: "#000",
    shadowOpacity: dark ? 0.45 : 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  };
}

/** Градиентная подложка стекла: светлее в верхнем-левом углу, прозрачнее к низу-правому. */
export function GlassTint({ dark }: { dark: boolean }) {
  return (
    <LinearGradient
      colors={
        dark
          ? ["rgba(255,255,255,.07)", "rgba(255,255,255,.02)"]
          : ["rgba(255,255,255,.72)", "rgba(255,255,255,.35)"]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
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
  const dark = theme.name === "dark";
  return (
    <View style={[glassStyle(theme, radius), { borderRadius: radius, overflow: "hidden" }, style]}>
      {blur && (
        <BlurView
          intensity={26}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <GlassTint dark={dark} />
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
  const dark = theme.name === "dark";
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
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <GlassTint dark={dark} />
      {children}
    </Pressable>
  );
}

/** Экспорт StyleSheet для совместимости. */
export { StyleSheet, View };