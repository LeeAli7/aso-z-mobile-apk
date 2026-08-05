/**
 * Button — primary/secondary/ghost/danger, ripple, haptic, loading.
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { useApp } from "../../store/AppStore";
import { radii } from "../tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
  fullWidth,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}) {
  const { theme } = useApp();
  const bg =
    variant === "primary" ? theme.accent
    : variant === "danger" ? theme.danger
    : variant === "secondary" ? theme.surface
    : "transparent";
  const fg =
    variant === "primary"
      ? theme.onAccent
      : variant === "danger" ? "#fff"
      : variant === "secondary" ? theme.text
      : theme.accentHi;
  const borderColor = variant === "secondary" || variant === "ghost" ? theme.border : "transparent";
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      android_ripple={{ color: theme.ripple }}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: radii.md,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.8 : disabled || loading ? 0.45 : 1,
        },
        fullWidth && { alignSelf: "stretch" },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={{ color: fg, fontSize: 14.5, fontWeight: "600" }}>{title}</Text>
      )}
    </Pressable>
  );
}
