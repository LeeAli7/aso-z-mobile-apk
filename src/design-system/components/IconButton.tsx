/**
 * IconButton — круглая/квадратная кнопка с иконкой MaterialIcons.
 * Тач ≥44×44, ripple на Android, haptic-отклик, pressed-состояние.
 */
import React from "react";
import { Pressable, ViewStyle } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
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
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useApp();
  const c = color ?? theme.dim;
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
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <MaterialIcons name={name} size={size} color={c} />
    </Pressable>
  );
}
