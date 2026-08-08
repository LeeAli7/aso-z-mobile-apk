/**
 * ToolCard — карточка инструмента в стиле Kimi.
 *
 * Свёрнутая строка: иконка + суть (команда/путь/запрос) — БЕЗ статусных
 * подписей, БЕЗ зелёных галочек. Клик открывает bottom-sheet с деталями:
 * сама команда и её ход (что вернула система) — как раздумья агента.
 * Во время работы иконка пульсирует.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons, MaterialIcons as MI } from "@expo/vector-icons";

export type ToolState = "loading" | "done" | "error";

/** Типы инструментов — иконка + нейтральный цвет (всё одинаковое). */
const TOOL_META: Record<string, { icon: keyof typeof MI.glyphMap }> = {
  shell: { icon: "terminal" },
  terminal: { icon: "terminal" },
  python: { icon: "code" },
  ipython: { icon: "code" },
  web_search: { icon: "search" },
  search: { icon: "search" },
  browser: { icon: "language" },
  read_file: { icon: "description" },
  write_file: { icon: "note-add" },
  edit_file: { icon: "edit" },
  todo: { icon: "checklist" },
  ask_user: { icon: "help-outline" },
  mcp: { icon: "extension" },
};

/** Префиксы глаголов — убираем, оставляем суть (команду/путь/запрос). */
const VERB_PREFIXES = ["выполняю ", "выполнял ", "пишу ", "создаю ", "создал ", "читаю ", "редактирую ", "ищу ", "запускаю ", "запустил "];

function metaFor(raw: string): { icon: keyof typeof MI.glyphMap } {
  const key = (raw || "").toLowerCase();
  if (key.includes("пишу") || key.includes("создаю") || key.includes("write")) return TOOL_META.write_file;
  if (key.includes("выполня") || key.includes("shell") || key.includes("терминал") || key.includes("запуск")) return TOOL_META.shell;
  if (key.includes("python") || key.includes("ipython")) return TOOL_META.python;
  if (key.includes("поиск") || key.includes("search")) return TOOL_META.web_search;
  if (key.includes("чита") || key.includes("read")) return TOOL_META.read_file;
  if (key.includes("редактир") || key.includes("edit")) return TOOL_META.edit_file;
  if (key.includes("todo") || key.includes("дело")) return TOOL_META.todo;
  if (key.includes("спросить") || key.includes("вопрос") || key.includes("ask")) return TOOL_META.ask_user;
  const exact = TOOL_META[key];
  if (exact) return exact;
  return { icon: "build" };
}

/** Суть действия: убрать глагольный префикс → «npm run build», «src/index.ts». */
function essence(raw: string): string {
  let s = (raw || "").trim();
  for (const p of VERB_PREFIXES) {
    if (s.toLowerCase().startsWith(p)) return s.slice(p.length).trim();
  }
  return s;
}

interface Props {
  /** Сырое название/событие инструмента (напр. "выполняю npm run build"). */
  tool: string;
  state: ToolState;
  /** Ход/вывод действия — показывается в sheet по клику. */
  output?: string;
  theme: any;
  /** Открыть sheet с деталями (команда + ход). */
  onOpen?: () => void;
  /** Голый режим: без рамки/фона — строка внутри единого блока цепочки. */
  bare?: boolean;
}

export function ToolCard({ tool, state, theme, output, onOpen, bare }: Props) {
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
  const label = essence(tool);
  const iconColor = state === "error" ? theme.danger : theme.dim;

  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.wrap,
        bare ? styles.wrapBare : null,
        { borderColor: !bare && state === "error" ? "rgba(255,56,73,.4)" : theme.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: theme.surface2 }]}>
        {state === "loading" ? (
          <Animated.View style={{ transform: [{ scale: iconScale }] }}>
            <MaterialIcons name={meta.icon} size={15} color={iconColor} />
          </Animated.View>
        ) : (
          <MaterialIcons name={meta.icon} size={15} color={iconColor} />
        )}
      </View>
      {label ? (
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 11.5, fontFamily: "monospace", flexShrink: 1 }}>
          {label}
        </Text>
      ) : null}
      {onOpen && (output || state !== "loading") ? (
        <MaterialIcons name="chevron-right" size={15} color={theme.mute} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  wrapBare: {
    alignSelf: "stretch",
    maxWidth: "100%",
    width: "100%",
    borderWidth: 0,
    borderRadius: 0,
    // внутри блока: контейнерный padding 8/12, строка компактная 4px вертикально
    paddingHorizontal: 0,
    paddingVertical: 4,
    marginBottom: 0,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});