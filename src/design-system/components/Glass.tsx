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

/**
 * «Жидкое стекло» (liquid glass, как в iOS): подложка-линза с преломлением.
 * Состоит из трёх слоёв:
 *  1. диагональный градиент — базовая полупрозрачность стекла,
 *  2. капля-блик (specular) — свет, преломлённый линзой, у верхнего левого края,
 *  3. нижняя каустика — слабый отсвет у нижней грани (свет «прошёл сквозь» каплю).
 */
export function GlassTint({ dark }: { dark: boolean }) {
  return (
    <>
      {/* 1) диагональная подложка: светлее сверху-слева */}
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
      {/* 2) капля-блик: мягкое пятно света у верхнего левого края (преломление линзы) */}
      <LinearGradient
        colors={
          dark
            ? ["rgba(255,255,255,.17)", "rgba(255,255,255,0)"]
            : ["rgba(255,255,255,.95)", "rgba(255,255,255,0)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "60%",
          height: "64%",
          borderRadius: 999,
          pointerEvents: "none",
        }}
      />
      {/* 3) нижняя каустика: свет прошёл сквозь каплю и собрался у нижней грани */}
      <LinearGradient
        colors={
          dark
            ? ["rgba(255,255,255,0)", "rgba(255,255,255,.05)"]
            : ["rgba(255,255,255,0)", "rgba(255,255,255,.22)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}

/**
 * Преломляющая кромка (rim): тонкая светлая линия ВНУТРИ по краю стекла.
 * В iOS-стекле край линзы всегда светится — это «кромка капли».
 */
export function GlassRim({ radius, dark }: { radius: number; dark: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0.5,
        left: 0.5,
        right: 0.5,
        bottom: 0.5,
        borderRadius: Math.max(2, radius - 1),
        borderWidth: 1,
        borderColor: dark ? "rgba(255,255,255,.13)" : "rgba(255,255,255,.75)",
        opacity: 0.85,
      }}
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
      <GlassRim radius={radius} dark={dark} />
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
      <GlassRim radius={radius} dark={dark} />
      {children}
    </Pressable>
  );
}

/** Экспорт StyleSheet для совместимости. */
export { StyleSheet, View };