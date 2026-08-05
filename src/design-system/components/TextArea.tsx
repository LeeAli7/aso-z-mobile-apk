/**
 * TextArea — многострочный инпут с авто-ростом до maxLines.
 */
import React, { useState } from "react";
import { TextInput, TextInputProps } from "react-native";
import { useApp } from "../../store/AppStore";
import { radii } from "../tokens";

export function TextArea({ maxLines = 6, style, ...props }: TextInputProps & { maxLines?: number }) {
  const { theme } = useApp();
  const [focused, setFocused] = useState(false);
  const lineHeight = 20;
  return (
    <TextInput
      {...props}
      multiline
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      placeholderTextColor={theme.mute}
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: focused ? theme.accent : theme.border,
          borderWidth: 1.5,
          borderRadius: radii.md,
          paddingHorizontal: 13,
          paddingVertical: 9,
          fontSize: 14,
          color: theme.text,
          minHeight: 40,
          maxHeight: lineHeight * maxLines + 18,
          textAlignVertical: "top",
        },
        style,
      ]}
    />
  );
}
