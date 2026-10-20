/**
 * Переключатель в стиле «КРОВЬ».
 * Системный Switch на Android и в web рисовал зелёный/бирюзовый трек —
 * это выходило из палитры (белый, чёрный, красный). Здесь:
 * включено — белая капсула с чёрной точкой, выключено — серая капсула.
 * Тач-таргет 44×44 по регламенту.
 */
import React from "react";
import { Pressable, View } from "react-native";

export default function Toggle({
  value,
  onChange,
  theme,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  theme: any;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 40,
          height: 24,
          borderRadius: 12,
          backgroundColor: value ? theme.text : theme.surface2,
          borderWidth: value ? 0 : 1,
          borderColor: theme.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: value ? "flex-end" : "flex-start",
          padding: 3,
        }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: value ? theme.onAccent : theme.mute,
          }}
        />
      </View>
    </Pressable>
  );
}
