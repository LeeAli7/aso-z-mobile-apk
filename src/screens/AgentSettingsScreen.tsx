/**
 * AgentSettingsScreen — конфигурация агента (Настройки → Агент).
 *
 * Разделы:
 *  - Память: просмотр фактов о пользователе и заметок, очистка.
 *  - Навыки: список SKILL.md (поиск по описанию), просмотр, создание, удаление.
 *  - Задачи: todo-список (создать/выполнить/удалить).
 *  - Автозадачи: cron-джобы (создать/пауза/удалить, следующий запуск).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { globalStore } from "../store/globalStore";
import { showToast } from "../design-system/components/Toast";
import { Button } from "../design-system/components/Button";
import { Chip } from "../design-system/components/Chip";
import { loadTodos, runTodoOps, TodoItem, clearTodos } from "../core/todo";
import { listSkills, viewSkill, saveSkill, deleteSkill } from "../core/skills";
import { memorySnapshot, clearMemory } from "../core/memory";
import { loadJobs, upsertJob, removeJob, setJobEnabled, upcoming, CronJob } from "../core/cron";
import { runCurator } from "../core/selfImprove";

export function AgentSettingsScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();

  const [memoryText, setMemoryText] = useState("");
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [skillBody, setSkillBody] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState({ name: "", description: "", body: "" });
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [jobDraft, setJobDraft] = useState({ name: "", schedule: "30m", prompt: "" });
  const [upcomingText, setUpcomingText] = useState("");

  const refresh = useCallback(async () => {
    const snap = await memorySnapshot().catch(() => "");
    setMemoryText(snap || "Память пуста.");
    const sk = await listSkills().catch(() => []);
    setSkills(sk);
    const td = await loadTodos().catch(() => []);
    setTodos(td);
    const jb = await loadJobs().catch(() => []);
    setJobs(jb);
    const up = await upcoming(jb).catch(() => []);
    setUpcomingText(up.join("\n") || "Автозадач нет");
  }, []);

  useEffect(() => {
    void refresh();
    // тик планировщика: обновляем «следующий запуск» каждые 30 сек
    const iv = setInterval(() => {
      void (async () => {
        const jb = await loadJobs().catch(() => []);
        setUpcomingText((await upcoming(jb).catch(() => [])).join("\n") || "Автозадач нет");
      })();
    }, 30_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleClearMemory = useCallback(() => {
    Alert.alert("Очистить память", "Удалить все факты о пользователе и заметки агента?", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Очистить", style: "destructive",
        onPress: async () => {
          await clearMemory();
          setMemoryText("Память пуста.");
          showToast("ok", "Память очищена");
        },
      },
    ]);
  }, []);

  const handleSaveSkill = useCallback(async () => {
    if (!skillDraft.name.trim() || !skillDraft.body.trim()) {
      showToast("err", "Заполни имя и тело навыка");
      return;
    }
    const msg = await saveSkill(
      skillDraft.name.trim().toLowerCase().replace(/\s+/g, "_"),
      skillDraft.description.trim(),
      skillDraft.body.trim(),
    );
    showToast(msg.startsWith("Навык") ? "ok" : "err", msg.slice(0, 120));
    setSkillDraft({ name: "", description: "", body: "" });
    setSkillBody(null);
    await refresh();
  }, [skillDraft, refresh]);

  const handleDeleteSkill = useCallback(async (name: string) => {
    Alert.alert("Удалить навык", `«${name}» будет удалён безвозвратно.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить", style: "destructive",
        onPress: async () => {
          const msg = await deleteSkill(name);
          showToast(msg.startsWith("Навык") ? "ok" : "err", msg.slice(0, 120));
          setSkillBody(null);
          await refresh();
        },
      },
    ]);
  }, [refresh]);

  const handleOpenSkill = useCallback(async (name: string) => {
    const body = await viewSkill(name);
    setSkillBody(body);
  }, []);

  const handleAddTodo = useCallback(async () => {
    if (!todoDraft.trim()) return;
    await runTodoOps([{ action: "add", content: todoDraft.trim() }]);
    setTodoDraft("");
    globalStore.notifyTodoChange();
    await refresh();
  }, [todoDraft, refresh]);

  const handleTodoStatus = useCallback(async (id: string, status: TodoItem["status"]) => {
    await runTodoOps([{ action: "update", id, status }]);
    globalStore.notifyTodoChange();
    await refresh();
  }, [refresh]);

  const handleRemoveTodo = useCallback(async (id: string) => {
    await runTodoOps([{ action: "remove", id }]);
    globalStore.notifyTodoChange();
    await refresh();
  }, [refresh]);

  const handleClearTodos = useCallback(async () => {
    await clearTodos();
    globalStore.notifyTodoChange();
    await refresh();
  }, [refresh]);

  const handleAddJob = useCallback(async () => {
    if (!jobDraft.prompt.trim()) {
      showToast("err", "Заполни текст автозадачи");
      return;
    }
    const j = await upsertJob({
      name: jobDraft.name.trim() || jobDraft.prompt.slice(0, 30),
      schedule: jobDraft.schedule.trim() || "30m",
      prompt: jobDraft.prompt.trim(),
      deliver: "chat",
    });
    showToast("ok", `Автозадача «${j.name}» создана`);
    setJobDraft({ name: "", schedule: "30m", prompt: "" });
    globalStore.notifyCronChange();
    await refresh();
  }, [jobDraft, refresh]);

  const handleToggleJob = useCallback(async (id: string, enabled: boolean) => {
    await setJobEnabled(id, enabled);
    globalStore.notifyCronChange();
    await refresh();
  }, [refresh]);

  const handleRemoveJob = useCallback(async (id: string) => {
    await removeJob(id);
    globalStore.notifyCronChange();
    await refresh();
  }, [refresh]);

  const c = theme;
  const card = { borderRadius: 15, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface };
  const label = { color: c.text, fontSize: 13.5, marginBottom: 8 };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }}>
          <MaterialIcons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <View>
          <Text style={{ color: c.dim, fontSize: 11 }}>AGENT</Text>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>Агент</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {/* ── Память ── */}
        <SectionTitle theme={c} icon="memory" text="Память" />
        <View style={[card, { padding: 14, marginTop: 4 }]}>
          <Text style={{ color: c.dim, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{memoryText.slice(0, 1200)}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
            <Button title="Очистить память" variant="danger" onPress={handleClearMemory} />
          </View>
        </View>

        {/* ── Навыки ── */}
        <SectionTitle theme={c} icon="book" text="Навыки (SKILL.md)" />
        <View style={[card, { padding: 14, marginTop: 4 }]}>
          {skills.length === 0 ? (
            <Text style={{ color: c.dim, fontSize: 12.5, marginBottom: 8 }}>Навыков пока нет. Агент создаёт их сам после сложных задач.</Text>
          ) : (
            skills.map((s) => (
              <Pressable key={s.name} onPress={() => handleOpenSkill(s.name)} android_ripple={{ color: c.ripple }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 9, opacity: pressed ? 0.8 : 1 })}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 13.5, fontWeight: "600", fontFamily: "monospace" }}>{s.name}</Text>
                  <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{s.description}</Text>
                </View>
                <Pressable onPress={() => handleDeleteSkill(s.name)} hitSlop={8} style={{ padding: 4 }}>
                  <MaterialIcons name="delete-outline" size={18} color={c.danger} />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
          {skillBody !== null ? (
            <View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <Text style={{ color: c.accentHi, fontSize: 11, fontFamily: "monospace" }}>SKILL.md</Text>
                <Pressable onPress={() => setSkillBody(null)}><Text style={{ color: c.dim, fontSize: 11 }}>скрыть</Text></Pressable>
              </View>
              <Text style={{ color: c.text, fontSize: 11.5, fontFamily: "monospace", lineHeight: 16 }} numberOfLines={12}>
                {skillBody.slice(0, 2500)}
              </Text>
            </View>
          ) : (
            <Text style={{ color: c.dim, fontSize: 12, marginBottom: 8 }}>Создать навык вручную:</Text>
          )}
          <TextInput
            value={skillDraft.name}
            onChangeText={(v) => setSkillDraft({ ...skillDraft, name: v })}
            placeholder="имя (латиница/дефисы)"
            placeholderTextColor={c.mute}
            autoCapitalize="none"
            style={[inputStyle(c), { fontFamily: "monospace" }]}
          />
          <View style={{ height: 6 }} />
          <TextInput
            value={skillDraft.description}
            onChangeText={(v) => setSkillDraft({ ...skillDraft, description: v })}
            placeholder="описание (по чему искать)"
            placeholderTextColor={c.mute}
            style={inputStyle(c)}
          />
          <View style={{ height: 6 }} />
          <TextInput
            value={skillDraft.body}
            onChangeText={(v) => setSkillDraft({ ...skillDraft, body: v })}
            placeholder="тело навыка: шаги, команды, питфоллы"
            placeholderTextColor={c.mute}
            multiline
            style={[inputStyle(c), { minHeight: 70, textAlignVertical: "top" }]}
          />
          <View style={{ height: 8 }} />
          <Button title="Сохранить навык" variant="primary" onPress={handleSaveSkill} />
          <View style={{ height: 8 }} />
          <Button title="Запустить куратора (архив старых)" variant="ghost" onPress={async () => {
            const msg = await runCurator();
            showToast("info", msg.slice(0, 120));
            await refresh();
          }} />
        </View>

        {/* ── Задачи ── */}
        <SectionTitle theme={c} icon="checklist" text="Задачи (todo)" />
        <View style={[card, { padding: 14, marginTop: 4 }]}>
          {todos.length === 0 ? (
            <Text style={{ color: c.dim, fontSize: 12.5, marginBottom: 8 }}>Задач нет.</Text>
          ) : (
            todos.map((t) => (
              <Pressable key={t.id} onPress={() => handleTodoStatus(t.id, t.status === "completed" ? "pending" : "completed")}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 8, opacity: pressed ? 0.8 : 1 })}>
                <MaterialIcons
                  name={t.status === "completed" ? "check-circle" : t.status === "in_progress" ? "autorenew" : "radio-button-unchecked"}
                  size={18} color={t.status === "completed" ? c.ok : c.dim}
                />
                <Text style={{ color: c.text, fontSize: 13, flex: 1, textDecorationLine: t.status === "completed" ? "line-through" : "none", opacity: t.status === "completed" ? 0.55 : 1 }}>
                  {t.content}
                </Text>
                <Pressable onPress={() => handleRemoveTodo(t.id)} hitSlop={8} style={{ padding: 2 }}>
                  <MaterialIcons name="close" size={16} color={c.danger} />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={todoDraft}
              onChangeText={setTodoDraft}
              placeholder="Новая задача…"
              placeholderTextColor={c.mute}
              style={[inputStyle(c), { flex: 1 }]}
              onSubmitEditing={handleAddTodo}
            />
            <Button title="Добавить" variant="primary" onPress={handleAddTodo} disabled={!todoDraft.trim()} />
          </View>
          {todos.length > 0 && (
            <Pressable onPress={handleClearTodos} style={{ marginTop: 8, alignSelf: "flex-start" }}>
              <Text style={{ color: c.danger, fontSize: 12 }}>Очистить все</Text>
            </Pressable>
          )}
        </View>

        {/* ── Автозадачи ── */}
        <SectionTitle theme={c} icon="schedule" text="Автозадачи (cron)" />
        <View style={[card, { padding: 14, marginTop: 4 }]}>
          {jobs.length === 0 ? (
            <Text style={{ color: c.dim, fontSize: 12.5, marginBottom: 8 }}>Автозадач нет. Создай: «каждый день в 9:00 напомни…»</Text>
          ) : (
            jobs.map((j) => (
              <View key={j.id} style={{ paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Switch
                  value={j.enabled}
                  onValueChange={(v) => handleToggleJob(j.id, v)}
                  trackColor={{ false: c.surface2, true: c.accent }}
                  thumbColor={j.enabled ? "#fff" : c.mute}
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>{j.name}</Text>
                  <Text style={{ color: c.dim, fontSize: 11, fontFamily: "monospace" }}>{j.schedule} · {j.prompt.slice(0, 50)}{j.prompt.length > 50 ? "…" : ""}</Text>
                  {j.lastResult ? <Text style={{ color: c.dim, fontSize: 10.5, marginTop: 2 }} numberOfLines={1}>↳ {j.lastResult}</Text> : null}
                </View>
                <Pressable onPress={() => handleRemoveJob(j.id)} hitSlop={8} style={{ padding: 2 }}>
                  <MaterialIcons name="delete-outline" size={18} color={c.danger} />
                </Pressable>
              </View>
            ))
          )}
          {upcomingText !== "Автозадач нет" && upcomingText ? (
            <Text style={{ color: c.accentHi, fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>{upcomingText}</Text>
          ) : null}
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
          <Text style={{ color: c.dim, fontSize: 12, marginBottom: 8 }}>
            Создать автозадачу: расписание — «30m», «every 2h», «0 9 * * *» (cron) или дата ISO.
          </Text>
          <TextInput
            value={jobDraft.name}
            onChangeText={(v) => setJobDraft({ ...jobDraft, name: v })}
            placeholder="Название (необязательно)"
            placeholderTextColor={c.mute}
            style={inputStyle(c)}
          />
          <View style={{ height: 6 }} />
          <TextInput
            value={jobDraft.schedule}
            onChangeText={(v) => setJobDraft({ ...jobDraft, schedule: v })}
            placeholder="Расписание: 30m / every 2h / 0 9 * * *"
            placeholderTextColor={c.mute}
            autoCapitalize="none"
            style={[inputStyle(c), { fontFamily: "monospace" }]}
          />
          <View style={{ height: 6 }} />
          <TextInput
            value={jobDraft.prompt}
            onChangeText={(v) => setJobDraft({ ...jobDraft, prompt: v })}
            placeholder="Что делать: текст задачи для агента…"
            placeholderTextColor={c.mute}
            multiline
            style={[inputStyle(c), { minHeight: 60, textAlignVertical: "top" }]}
          />
          <View style={{ height: 8 }} />
          <Button title="Создать автозадачу" variant="primary" onPress={handleAddJob} disabled={!jobDraft.prompt.trim()} />
        </View>

        <View style={{ height: 12 }} />
        <Text style={{ color: c.mute, fontSize: 11, lineHeight: 16 }}>
          Автозадачи выполняются, пока приложение открыто (фоновая работа ограничена Android). Результат приходит в чат.
        </Text>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ theme, icon, text }: { theme: any; icon: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, marginBottom: 2 }}>
      <MaterialIcons name={icon as any} size={15} color={theme.accentHi} />
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

function inputStyle(c: any) {
  return {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    backgroundColor: c.surface2,
    color: c.text,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
  };
}