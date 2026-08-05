/**
 * Chip — маленькая кнопка-тег (быстрые действия, фильтры).
 */
import React from "react";
import { Pressable, Text } from "react-native";
import { useApp } from "../../store/AppStore";
import { radii } from "../tokens";

export function Chip({ label, onPress, active }: { label: string; onPress?: () => void; active?: boolean }) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.ripple, borderless: false }}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.border,
        backgroundColor: active ? theme.accentDim : theme.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: active ? theme.accentHi : theme.dim, fontSize: 12, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}
