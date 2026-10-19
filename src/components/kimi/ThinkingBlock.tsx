/**
 * ThinkingBlock — раздумья агента в стиле КРОВЬ.
 *
 * Это цитата: вертикальная черта слева + серый текст. Никаких плашек,
 * иконок и статусов. Во время работы — «…» и «Пропустить».
 * Клик открывает окно с полным текстом размышлений.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type ThinkingStatus = "thinking" | "done" | "cancelled";

interface Props {
  text?: string;
  status: ThinkingStatus;
  onSkip?: () => void;
  onOpen?: () => void;
  theme: any;
  bare?: boolean;
}

export function ThinkingBlock({ text, status, onSkip, onOpen, theme, bare }: Props) {
  const isThinking = status === "thinking";
  const canOpen = !!text && !isThinking;

  return (
    <View style={[styles.wrap, bare ? styles.wrapBare : null, { borderLeftColor: theme.name === "dark" ? "#2c2c30" : "#d8d8dc" }]}>
      <Pressable
        onPress={() => canOpen && onOpen?.()}
        disabled={!canOpen}
        accessibilityRole={canOpen ? "button" : undefined}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, opacity: pressed ? 0.6 : 1 }]}
        hitSlop={8}
      >
        <Text style={{ color: theme.dim, fontSize: 13, fontWeight: "500" }}>
          {isThinking ? "Думаю…" : "Думаю"}
        </Text>
        {isThinking && onSkip && (
          <Pressable onPress={(e) => { e.stopPropagation?.(); onSkip(); }} hitSlop={8}>
            <Text style={{ color: theme.mute, fontSize: 11 }}>Пропустить</Text>
          </Pressable>
        )}
        {canOpen && <Text style={{ color: theme.mute, fontSize: 12 }}>›</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginBottom: 4,
    borderLeftWidth: 2,
    paddingLeft: 10,
  },
  wrapBare: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginBottom: 0,
  },
});
