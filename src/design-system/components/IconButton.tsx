/**
 * IconButton — круглая стеклянная кнопка с иконкой MaterialIcons.
 *
 * Без BlurView: стекло рисуется стилями (полупрозрачный фон + рамка + блик).
 * На Android это надёжно: тач-таргет ровно 44×44, иконка не режется,
 * тачи не перехватываются. ripple + haptic.
 */
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { useApp } from "../../store/AppStore";
import { hitSlop, touchTarget } from "../tokens";
import { GlassTint, GlassRim } from "./Glass";

export type IconName = keyof typeof MaterialIcons.glyphMap;

export function IconButton({
  name,
  onPress,
  size = 20,
  color,
  style,
  disabled,
  haptic = true,
  accessibilityLabel,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: React.CSSProperties | any;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useApp();
  const dark = theme.name === "dark";
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: theme.ripple, borderless: true }}
      style={({ pressed }) => [
        {
          width: touchTarget,
          height: touchTarget,
          borderRadius: touchTarget / 2,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderWidth: 1,
          borderColor: dark ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.75)",
          borderTopWidth: 1.5,
          backgroundColor: dark ? "rgba(20,20,24,.40)" : "rgba(255,255,255,.45)",
          shadowColor: "#000",
          shadowOpacity: dark ? 0.4 : 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          elevation: 4,
          opacity: pressed ? 0.75 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <BlurView
        intensity={26}
        tint={dark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* капля-блик + преломляющая кромка (liquid glass) */}
      <GlassTint dark={dark} />
      <GlassRim radius={touchTarget / 2} dark={dark} />
      <MaterialIcons name={name} size={size} color={color ?? theme.dim} />
    </Pressable>
  );
}