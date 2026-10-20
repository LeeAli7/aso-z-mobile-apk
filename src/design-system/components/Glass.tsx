/**
 * Поверхности приложения в стиле КРОВЬ.
 *
 * Никакого стекла: без BlurView, без градиентов, без полупрозрачных рамок.
 * Карточка — это карточка: фон #141416, радиус 20, тонкая непрозрачная
 * рамка 1px. Полупрозрачные слои давали мутные полосы и бледные иконки —
 * в чёрно-белой системе это читается как грязь, а не как материал.
 *
 * Имена экспортов сохранены (Glass, GlassPressable, GlassTint, GlassRim,
 * glassStyle), чтобы существующие экраны продолжали собираться.
 */
import React from "react";
import { StyleSheet, View, ViewStyle, Pressable } from "react-native";
import { useApp } from "../../store/AppStore";

const RADIUS_CARD = 20;

/** Поверхность карточки. */
export function glassStyle(theme: any, radius: number = RADIUS_CARD, border = true): ViewStyle {
  const base: ViewStyle = {
    borderRadius: radius,
    backgroundColor: theme.surface,
  };
  // border=false — чистый залив без обводки (капсула ввода): рамка вокруг
  // капсулы читалась как «второй прямоугольник» в обеих темах.
  return border ? { ...base, borderWidth: 1, borderColor: theme.border } : base;
}

/** Пустой слой: раньше здесь был градиентный блик. */
export function GlassTint(_: { dark: boolean }) {
  return null;
}

/** Пустой слой: раньше здесь была преломляющая кромка. */
export function GlassRim(_: { radius: number; dark: boolean }) {
  return null;
}

/** Карточка-контейнер (некликабельная). */
export function Glass({
  radius = RADIUS_CARD,
  style,
  children,
  border = true,
}: {
  radius?: number;
  style?: ViewStyle;
  children: React.ReactNode;
  blur?: boolean;
  border?: boolean;
}) {
  const { theme } = useApp();
  return <View style={[glassStyle(theme, radius, border), style]}>{children}</View>;
}

/** Кликабельная поверхность. */
export function GlassPressable({
  onPress,
  radius = RADIUS_CARD,
  style,
  pressedStyle,
  disabled,
  children,
  accessibilityLabel,
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
        { opacity: pressed ? 0.7 : disabled ? 0.4 : 1 },
        style,
        pressed ? pressedStyle : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Экспорт StyleSheet для совместимости. */
export { StyleSheet, View };
