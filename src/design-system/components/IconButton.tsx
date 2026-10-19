/**
 * IconButton — круглая кнопка с иконкой AppIcon в стиле КРОВЬ.
 *
 * Плотная поверхность #141416 без рамок и прозрачности: иконка белая,
 * тач-таргет 44×44, ripple + haptic.
 */
import React from "react";
import { Pressable } from "react-native";
import { AppIcon, AppIconName } from "./AppIcon";
import * as Haptics from "expo-haptics";
import { useApp } from "../../store/AppStore";
import { hitSlop, touchTarget } from "../tokens";


export type IconName = AppIconName;

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
          backgroundColor: pressed ? theme.surface2 : theme.surface,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <AppIcon name={name} size={size} color={color ?? theme.text} />
    </Pressable>
  );
}