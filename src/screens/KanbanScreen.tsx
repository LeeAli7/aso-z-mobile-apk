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
import { listTasks, createTask, assignTask, setTaskStatus, completeTask, deleteTask } from "../core/kanban";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { Button } from "../design-system/components/Button";
import { confirmDangerous } from "../core/confirm";

type Col = "todo" | "doing" | "done";
interface Kb { id: string; title: string; assignee: string; col: Col; blocked: boolean }

// тап двигает статус по кругу: done возвращается в todo, иначе завершённую задачу нельзя переоткрыть
const NEXT: Record<Col, Col> = { todo: "doing", doing: "done", done: "todo" };

/** Доска читается из единого движка core/kanban — тот же стор, что видит агент. */
async function readKb(): Promise<Kb[]> {
  const list = await listTasks();
  return list
    .filter((x) => x.status !== "archived")
    .map((x) => ({
      id: x.id,
      title: x.title,
      assignee: x.assignee ?? "",
      col: x.status === "done" ? "done" : x.status === "doing" || x.status === "blocked" ? "doing" : "todo",
      blocked: x.status === "blocked",
    }));
}

export function KanbanScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<Kb[]>([]);
  const [draft, setDraft] = useState({ title: "", assignee: "" });

  const load = useCallback(async () => setTasks(await readKb()), []);
  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    const task = await createTask(title);
    const who = draft.assignee.trim();
    if (who) await assignTask(task.id, who);
    setDraft({ title: "", assignee: "" });
    await load();
  }, [draft, load]);

  const forward = useCallback(async (id: string) => {
    const cur = tasks.find((x) => x.id === id)?.col ?? "todo";
    const nx = NEXT[cur];
    if (nx === "done") await completeTask(id);
    else await setTaskStatus(id, nx);
    await load();
  }, [tasks, load]);

  const del = useCallback(async (id: string) => {
    await deleteTask(id);
    await load();
  }, [load]);

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
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
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
                <AppIcon
                  name={x.col === "done" ? "check-circle" : x.col === "doing" ? "refresh" : "circle"}
                  size={17}
                  color={x.blocked ? theme.danger : x.col === "done" ? theme.ok : theme.dim}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, textDecorationLine: x.col === "done" ? "line-through" : "none", opacity: x.col === "done" ? 0.55 : 1 }}>
                    {x.title}
                  </Text>
                  {x.assignee ? <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{x.assignee}</Text> : null}
                </View>
                {x.blocked ? (
                  <Pressable
                    onPress={async () => {
                      // раньше заблокированную задачу можно было только удалить
                      const { unblockTask } = await import("../core/kanban");
                      await unblockTask(x.id);
                      await load();
                    }}
                    hitSlop={8}
                    style={{ padding: 4 }}
                    accessibilityLabel="Разблокировать задачу"
                  >
                    <AppIcon name="check-circle" size={14} color={theme.text} />
                  </Pressable>
                ) : null}
                {NEXT[x.col] ? <AppIcon name="chevron-right" size={16} color={theme.mute} /> : null}
                <Pressable
                  onPress={() => confirmDangerous("Удалить задачу?", x.title, () => del(x.id))}
                  hitSlop={8}
                  style={{ padding: 4 }}
                  accessibilityLabel="Удалить задачу"
                >
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
