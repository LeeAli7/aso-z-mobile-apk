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
export function glassStyle(theme: any, radius: number = RADIUS_CARD): ViewStyle {
  return {
    borderRadius: radius,
    borderWidth: 1,
    borderColor: theme.name === "dark" ? "#1f1f22" : "#e2e2e6",
    backgroundColor: theme.name === "dark" ? "#141416" : "#f5f5f7",
  };
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
}: {
  radius?: number;
  style?: ViewStyle;
  children: React.ReactNode;
  blur?: boolean;
}) {
  const { theme } = useApp();
  return <View style={[glassStyle(theme, radius), style]}>{children}</View>;
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
