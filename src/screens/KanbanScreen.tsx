/**
 * KanbanScreen — доска агентов (UI Hermes-паритета, локальный стор).
 *
 * Три колонки: todo / doing / done, карточки с исполнителем,
 * добавление снизу, тапы двигают задачу вперёд. Без эмодзи.
 *
 * NATIVE OWNER (Арес): движок kanban (create/assign/status, SQLite-борда)
 * — заменить AsyncStorage-стор ниже на вызовы движка, UI не менять.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { Button } from "../design-system/components/Button";

const KEY_KB = "aso_kanban_tasks";

type Col = "todo" | "doing" | "done";
interface Kb { id: string; title: string; assignee: string; col: Col }

const NEXT: Record<Col, Col | null> = { todo: "doing", doing: "done", done: null };

async function readKb(): Promise<Kb[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_KB);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function KanbanScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<Kb[]>([]);
  const [draft, setDraft] = useState({ title: "", assignee: "" });

  const load = useCallback(async () => setTasks(await readKb()), []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (next: Kb[]) => {
    setTasks(next);
    await AsyncStorage.setItem(KEY_KB, JSON.stringify(next));
  }, []);

  const add = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    await save([...tasks, { id: genId(), title, assignee: draft.assignee.trim(), col: "todo" }]);
    setDraft({ title: "", assignee: "" });
  }, [tasks, draft, save]);

  const forward = useCallback(async (id: string) => {
    const nx = NEXT[tasks.find((x) => x.id === id)?.col ?? "todo"];
    if (!nx) return;
    await save(tasks.map((x) => (x.id === id ? { ...x, col: nx } : x)));
  }, [tasks, save]);

  const del = useCallback(async (id: string) => {
    await save(tasks.filter((x) => x.id !== id));
  }, [tasks, save]);

  const input = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    backgroundColor: theme.surface2, color: theme.text, fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 9,
  };
  const cols: { key: Col; label: string }[] = [
    { key: "todo", label: "TODO" },
    { key: "doing", label: "DOING" },
    { key: "done", label: "DONE" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }} accessibilityLabel={t("back")}>
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View>
          <Text style={{ color: theme.dim, fontSize: 11 }}>{t("kanban_sub")}</Text>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>{t("kanban_title")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {tasks.length === 0 ? (
          <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 10 }}>{t("kb_empty")}</Text>
        ) : null}
        {cols.map((c) => (
          <View key={c.key} style={{ marginBottom: 12 }}>
            <Text style={{ color: theme.mute, fontSize: 10, letterSpacing: 1.2, marginBottom: 6 }}>
              {c.label} · {tasks.filter((x) => x.col === c.key).length}
            </Text>
            {tasks.filter((x) => x.col === c.key).map((x) => (
              <Pressable
                key={x.id}
                onPress={() => forward(x.id)}
                android_ripple={{ color: theme.ripple }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}
              >
                <AppIcon name={x.col === "done" ? "check-circle" : x.col === "doing" ? "refresh" : "circle"} size={17} color={x.col === "done" ? theme.ok : theme.dim} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, textDecorationLine: x.col === "done" ? "line-through" : "none", opacity: x.col === "done" ? 0.55 : 1 }}>
                    {x.title}
                  </Text>
                  {x.assignee ? <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{x.assignee}</Text> : null}
                </View>
                {NEXT[x.col] ? <AppIcon name="chevron-right" size={16} color={theme.mute} /> : null}
                <Pressable onPress={() => del(x.id)} hitSlop={8} style={{ padding: 4 }}>
                  <AppIcon name="close" size={14} color={theme.danger} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
        <TextInput value={draft.title} onChangeText={(v) => setDraft({ ...draft, title: v })} placeholder={t("kb_add_ph")} placeholderTextColor={theme.mute} style={input} onSubmitEditing={add} />
        <View style={{ height: 6 }} />
        <TextInput value={draft.assignee} onChangeText={(v) => setDraft({ ...draft, assignee: v })} placeholder={t("kb_assignee_ph")} placeholderTextColor={theme.mute} autoCapitalize="none" style={input} onSubmitEditing={add} />
        <View style={{ height: 8 }} />
        <Button title={t("create")} variant="primary" onPress={add} disabled={!draft.title.trim()} />
      </ScrollView>
    </View>
  );
}
