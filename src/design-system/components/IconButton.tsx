/**
 * IconButton — круглая кнопка-стекло с иконкой MaterialIcons.
 * Глэссморфизм (BlurView + рамка + блик), тач ≥44×44, ripple, haptic.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useApp } from "../../store/AppStore";
import { hitSlop, touchTarget } from "../tokens";

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
  glass = true,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: React.CSSProperties | any;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
  /** стеклянная подложка (глэссморфизм) — по умолчанию вкл */
  glass?: boolean;
}) {
  const { theme } = useApp();
  const c = color ?? theme.dim;
  const tint = theme.name === "dark" ? "dark" : "light";
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
          borderWidth: 1,
          borderColor: glass
            ? theme.name === "dark" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.55)"
            : theme.border,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 5,
          opacity: pressed ? 0.68 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {glass && (
        <BlurView
          intensity={36}
          tint={tint}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: touchTarget / 2 }}
        />
      )}
      <MaterialIcons name={name} size={size} color={c} />
    </Pressable>
  );
}