/**
 * Input — поле ввода с label/error, focus-подсветкой.
 */
import React, { useState } from "react";
import { Text, TextInput, TextInputProps, View } from "react-native";
import { useApp } from "../../store/AppStore";
import { radii } from "../tokens";

export function Input({
  label,
  error,
  helper,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string; helper?: string }) {
  const { theme } = useApp();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={{ color: theme.dim, fontSize: 12, marginLeft: 2 }}>{label}</Text> : null}
      <TextInput
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        placeholderTextColor={theme.mute}
        style={[
          {
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : focused ? theme.accent : theme.border,
            borderWidth: 1.5,
            borderRadius: radii.md,
            paddingHorizontal: 13,
            paddingVertical: 11,
            fontSize: 14,
            color: theme.text,
            minHeight: 44,
          },
          style,
        ]}
      />
      {error ? <Text style={{ color: theme.danger, fontSize: 11.5, marginLeft: 2 }}>{error}</Text> : null}
      {helper && !error ? <Text style={{ color: theme.mute, fontSize: 11.5, marginLeft: 2 }}>{helper}</Text> : null}
    </View>
  );
}
