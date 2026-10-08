/**
 * KanbanScreen — доска агентов (через движок core/kanban).
 *
 * Колонки: todo / doing / done (+ blocked/archived из движка: блок и архив
 * доступны долгим списком действий на карточке), карточки с исполнителем,
 * добавление снизу, тап двигает задачу вперёд.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { Button } from "../design-system/components/Button";
import { showToast } from "../design-system/components/Toast";
import {
  listTasks, createTask, deleteTask, blockTask, unblockTask, archiveTask,
  type KanbanStatus, type KanbanTask,
} from "../core/kanban";

type Col = "todo" | "doing" | "done" | "blocked" | "archived";

const NEXT: Record<Col, Col | null> = { todo: "doing", doing: "done", done: null, blocked: null, archived: null };

function colOf(t: KanbanTask): Col {
  return (t.status as Col) ?? "todo";
}

export function KanbanScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [draft, setDraft] = useState({ title: "", assignee: "" });

  const load = useCallback(async () => setTasks(await listTasks().catch(() => [])), []);
  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    await createTask(title).catch(() => null);
    // assignee сразу после создания (движок держит его отдельно)
    const created = (await listTasks().catch(() => []))[0];
    if (created && draft.assignee.trim()) {
      const { assignTask } = await import("../core/kanban");
      await assignTask(created.id, draft.assignee.trim()).catch(() => false);
    }
    setTasks(await listTasks().catch(() => []));
    setDraft({ title: "", assignee: "" });
  }, [draft]);

  const forward = useCallback(async (id: string) => {
    const cur = tasks.find((x) => x.id === id);
    const col = cur ? colOf(cur) : "todo";
    if (col === "blocked") {
      await unblockTask(id).catch(() => false);
    } else {
      const nx = NEXT[col];
      if (!nx || nx === "blocked" || nx === "archived") return;
      const { setTaskStatus } = await import("../core/kanban");
      await setTaskStatus(id, nx as KanbanStatus).catch(() => false);
    }
    setTasks(await listTasks().catch(() => []));
  }, [tasks]);

  const toggleBlock = useCallback(async (id: string) => {
    const cur = tasks.find((x) => x.id === id);
    if (!cur) return;
    if (colOf(cur) === "blocked") await unblockTask(id).catch(() => false);
    else await blockTask(id).catch(() => false);
    setTasks(await listTasks().catch(() => []));
  }, [tasks]);

  const archive = useCallback(async (id: string) => {
    await archiveTask(id).catch(() => false);
    setTasks(await listTasks().catch(() => []));
    showToast("ok", "В архиве");
  }, []);

  const del = useCallback(async (id: string) => {
    await deleteTask(id).catch(() => false);
    setTasks(await listTasks().catch(() => []));
  }, []);

  const input = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    backgroundColor: theme.surface2, color: theme.text, fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 9,
  };
  const cols: { key: Col; label: string }[] = [
    { key: "todo", label: "TODO" },
    { key: "doing", label: "DOING" },
    { key: "done", label: "DONE" },
    { key: "blocked", label: "BLOCKED" },
  ];
  const archivedCount = tasks.filter((x) => colOf(x) === "archived").length;

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
              {c.label} · {tasks.filter((x) => colOf(x) === c.key).length}
            </Text>
            {tasks.filter((x) => colOf(x) === c.key).map((x) => {
              const col = colOf(x);
              const blocked = col === "blocked";
              return (
              <Pressable
                key={x.id}
                onPress={() => forward(x.id)}
                android_ripple={{ color: theme.ripple }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: blocked ? theme.warn : theme.border, backgroundColor: theme.surface, marginBottom: 6 }}
              >
                <AppIcon name={col === "done" ? "check-circle" : col === "doing" ? "refresh" : blocked ? "stop" : "circle"} size={17} color={col === "done" ? theme.ok : blocked ? theme.warn : theme.dim} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, textDecorationLine: col === "done" ? "line-through" : "none", opacity: col === "done" ? 0.55 : 1 }}>
                    {x.title}
                  </Text>
                  {x.assignee ? <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{x.assignee}</Text> : null}
                  {x.comments.length > 0 ? <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{x.comments.length} коммент.</Text> : null}
                </View>
                {NEXT[col] || blocked ? <AppIcon name="chevron-right" size={16} color={theme.mute} /> : null}
                <Pressable onPress={() => toggleBlock(x.id)} hitSlop={8} style={{ padding: 4 }} accessibilityLabel={blocked ? "Разблокировать" : "Заблокировать"}>
                  <AppIcon name={blocked ? "refresh" : "stop"} size={14} color={blocked ? theme.warn : theme.mute} />
                </Pressable>
                <Pressable onPress={() => archive(x.id)} hitSlop={8} style={{ padding: 4 }} accessibilityLabel="В архив">
                  <AppIcon name="box" size={14} color={theme.mute} />
                </Pressable>
                <Pressable onPress={() => del(x.id)} hitSlop={8} style={{ padding: 4 }}>
                  <AppIcon name="close" size={14} color={theme.danger} />
                </Pressable>
              </Pressable>
              );
            })}
          </View>
        ))}
        {archivedCount > 0 && (
          <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 8 }}>В архиве: {archivedCount}</Text>
        )}
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
