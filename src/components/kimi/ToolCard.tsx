/**
 * ToolCard — строка инструмента в стиле КРОВЬ.
 *
 * Плоская строка: иконка + суть (команда/путь/запрос) моно-шрифтом.
 * Без плашек под иконкой, без рамок, без статусных подписей и зелёных
 * галочек. Клик открывает окно с деталями — сама команда и её вывод.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, AppIconName } from "../../design-system/components/AppIcon";
import { fonts } from "../../theme/tokens";

export type ToolState = "loading" | "done" | "error";

const TOOL_META: Record<string, { icon: AppIconName }> = {
  shell: { icon: "terminal" },
  terminal: { icon: "terminal" },
  python: { icon: "terminal" },
  ipython: { icon: "terminal" },
  web_search: { icon: "search" },
  search: { icon: "search" },
  browser: { icon: "globe" },
  read_file: { icon: "file" },
  write_file: { icon: "file" },
  edit_file: { icon: "edit" },
  todo: { icon: "check" },
  ask_user: { icon: "info" },
  mcp: { icon: "model" },
};

const VERB_PREFIXES = ["выполняю ", "выполнял ", "пишу ", "создаю ", "создал ", "читаю ", "редактирую ", "ищу ", "запускаю ", "запустил "];

function metaFor(raw: string): { icon: AppIconName } {
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
  return { icon: "more" };
}

function essence(raw: string): string {
  let s = (raw || "").trim();
  for (const p of VERB_PREFIXES) {
    if (s.toLowerCase().startsWith(p)) return s.slice(p.length).trim();
  }
  return s;
}

interface Props {
  tool: string;
  state: ToolState;
  output?: string;
  theme: any;
  onOpen?: () => void;
  bare?: boolean;
}

export function ToolCard({ tool, state, theme, onOpen, bare }: Props) {
  const meta = metaFor(tool);
  const label = essence(tool);
  const iconColor = state === "error" ? theme.danger : theme.dim;

  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      accessibilityRole="button"
      style={({ pressed }) => [styles.wrap, bare ? styles.wrapBare : null, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppIcon name={meta.icon} size={15} color={iconColor} />
      {label ? (
        <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 12, fontFamily: fonts.mono, flexShrink: 1 }}>
          {label}
        </Text>
      ) : null}
      {onOpen ? <AppIcon name="chevron-right" size={14} color={theme.mute} /> : null}
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
    paddingVertical: 6,
    marginBottom: 2,
  },
  wrapBare: {
    alignSelf: "stretch",
    maxWidth: "100%",
    width: "100%",
    paddingVertical: 5,
    marginBottom: 0,
  },
});
