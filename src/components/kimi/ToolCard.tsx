/**
 * ToolCard — карточка инструмента в стиле Kimi.
 *
 * Паттерн Kimi (okc_tool_*, строки из APK): каждая операция = карточка
 * «иконка + статус»:
 *   loading: «Используется X»  → done: «Использовать X» / error: «Не удалось использовать X»
 *   shell:   «Выполнение командной строки» → «Выполнить командную строку»
 *   python:  «Выполняется код Python»      → «Выполнить код Python»
 *
 * Анимация: пульсирующая иконка во время работы (эквивалент tool-*.riv),
 * галочка/крестик в финальном состоянии.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { MaterialIcons, MaterialIcons as MI } from "@expo/vector-icons";

export type ToolState = "loading" | "done" | "error";

/** Типы инструментов — маппинг на Kimi-названия (RU из APK) и иконки. */
const TOOL_META: Record<string, { label: string; icon: keyof typeof MI.glyphMap }> = {
  shell: { label: "Командная строка", icon: "terminal" },
  terminal: { label: "Командная строка", icon: "terminal" },
  python: { label: "iPython", icon: "code" },
  ipython: { label: "iPython", icon: "code" },
  web_search: { label: "Веб-поиск", icon: "search" },
  search: { label: "Веб-поиск", icon: "search" },
  browser: { label: "Браузер", icon: "language" },
  read_file: { label: "Чтение файла", icon: "description" },
  write_file: { label: "Файл", icon: "note-add" },
  edit_file: { label: "Редактирование", icon: "edit" },
  todo: { label: "Дело", icon: "checklist" },
  ask_user: { label: "Запрос", icon: "help-outline" },
  mcp: { label: "MCP", icon: "extension" },
};

function metaFor(raw: string): { label: string; icon: keyof typeof MI.glyphMap } {
  const key = (raw || "").toLowerCase();
  // "пишу src/index.ts" → write_file; "выполняю npm run build" → shell
  if (key.includes("пишу") || key.includes("создаю") || key.includes("write")) return TOOL_META.write_file;
  if (key.includes("выполня") || key.includes("shell") || key.includes("терминал")) return TOOL_META.shell;
  if (key.includes("python") || key.includes("ipython")) return TOOL_META.python;
  if (key.includes("поиск") || key.includes("search")) return TOOL_META.web_search;
  if (key.includes("чита") || key.includes("read")) return TOOL_META.read_file;
  if (key.includes("редактир") || key.includes("edit")) return TOOL_META.edit_file;
  if (key.includes("todo") || key.includes("дело")) return TOOL_META.todo;
  if (key.includes("спросить") || key.includes("вопрос") || key.includes("ask")) return TOOL_META.ask_user;
  const exact = TOOL_META[key];
  if (exact) return exact;
  return { label: raw || "Инструмент", icon: "build" };
}

interface Props {
  /** Сырое название/событие инструмента (напр. "пишу src/index.ts"). */
  tool: string;
  state: ToolState;
  theme: any;
}

export function ToolCard({ tool, state, theme }: Props) {
  const meta = metaFor(tool);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== "loading") return;
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    l.start();
    return () => l.stop();
  }, [state, pulse]);

  const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [theme.accentDim, "rgba(26,136,255,.28)"] });

  const label = tool.includes("пишу ") ? tool.replace("пишу ", "") : tool;
  const stateText =
    state === "loading" ? "Используется" :
    state === "done" ? "Использовать" : "Не удалось использовать";

  const stateColor = state === "error" ? theme.danger : state === "done" ? theme.ok : theme.accentHi;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: state === "error" ? "rgba(255,56,73,.4)" : theme.border,
          backgroundColor: state === "error" ? "rgba(255,56,73,.06)" : theme.surface,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: theme.accentDim }]}>
        {state === "loading" ? (
          <Animated.View style={{ transform: [{ scale: iconScale }], opacity: glow as unknown as number }}>
            <MaterialIcons name={meta.icon} size={15} color={theme.accentHi} />
          </Animated.View>
        ) : state === "done" ? (
          <MaterialIcons name="check" size={15} color={theme.ok} />
        ) : (
          <MaterialIcons name="close" size={15} color={theme.danger} />
        )}
      </View>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <Text style={{ color: theme.dim, fontSize: 11.5 }}>{stateText}</Text>
        <Text numberOfLines={1} style={{ color: stateColor, fontSize: 11.5, fontWeight: "600", fontFamily: "monospace" }}>
          {meta.label}{label && !tool.includes("пишу ") ? ` · ${label}` : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});
