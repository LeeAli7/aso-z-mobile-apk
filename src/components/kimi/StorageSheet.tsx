/**
 * StorageSheet — «Хранилище» приложения: корневая папка (как Hermes).
 *
 * Концепция: при нажатии на «Хранилище» открывается корневая папка,
 * внутри — системные папки, которые агент наполняет сам:
 *   • Проекты     — папки-проекты (агент создаёт их по запросу юзера)
 *   • Инструкции  — INSTRUCTIONS.md текущего проекта (правила для агента)
 *   • Самообучение— память агента: что он выучил/записал за время работы
 *   • Промпты     — заготовки промптов
 *   • Скиллы      — навыки агента (как скиллы Hermes)
 *
 * Без ручных кнопок «создать проект»: пользователь говорит агенту
 * «создай проект X» — агент создаёт папку и файлы сам.
 * Навигация папками с хлебными крошками; копировать/переносить — позже.
 *
 * Всё в стиле Kimi: стеклянные панели, капсулы, Geist Mono, без эмодзи.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../../store/AppStore";
import { Sheet } from "../../design-system/components/Sheet";
import { GlassPressable } from "../../design-system/components/Glass";
import { Button } from "../../design-system/components/Button";
import { Input } from "../../design-system/components/Input";
import { fonts } from "../../theme/tokens";
import {
  VibeProject,
  listProjects,
  treeFiles,
  readFile,
  writeFile,
} from "../../core/vibeLocal";
import { showToast } from "../../design-system/components/Toast";
import { memorySnapshot, clearMemory } from "../../core/memory";
import { loadTodos, runTodoOps, clearTodos } from "../../core/todo";
import { loadJobs, upsertJob, removeJob, setJobEnabled, upcoming } from "../../core/cron";
import { runCurator } from "../../core/selfImprove";

const INSTRUCTIONS_FILE = "INSTRUCTIONS.md";

/** Путь в корневой папке: [] = корень, ["projects"], ["instructions"] … */
type Path = string[];

const ROOT_FOLDERS: { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; desc: string }[] = [
  { key: "projects", label: "Проекты", icon: "folder", desc: "папки-проекты агента" },
  { key: "skills", label: "Скиллы", icon: "extension", desc: "навыки, инструкции, самообучение" },
  { key: "memory", label: "Память", icon: "memory", desc: "факты о пользователе, заметки агента" },
  { key: "todo", label: "Задачи", icon: "checklist", desc: "план дел агента (todo)" },
  { key: "cron", label: "Автозадачи", icon: "schedule", desc: "расписание, напоминания, отчёты" },
  { key: "connectors", label: "Коннекторы", icon: "link", desc: "подключённые сервисы и инструменты" },
];

export function StorageSheet({
  visible,
  onClose,
  activeProjectId,
  onSelectProject,
}: {
  visible: boolean;
  onClose: () => void;
  activeProjectId: string | null;
  onSelectProject: (p: VibeProject | null) => void;
}) {
  const { theme } = useApp();
  const [path, setPath] = useState<Path>([]);
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");

  const [instrText, setInstrText] = useState("");
  const [instrDirty, setInstrDirty] = useState(false);

  // ── агентские разделы: память / задачи / автозадачи ──
  const [memText, setMemText] = useState("Память пуста.");
  const [todoItems, setTodoItems] = useState<any[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobDraft, setJobDraft] = useState({ name: "", schedule: "30m", prompt: "" });
  const [upcomingText, setUpcomingText] = useState("");

  const refreshAgent = useCallback(async () => {
    const snap = await memorySnapshot().catch(() => "");
    setMemText(snap || "Память пуста.");
    setTodoItems(await loadTodos().catch(() => []));
    const jb = await loadJobs().catch(() => []);
    setJobs(jb);
    setUpcomingText((await upcoming(jb).catch(() => [])).join("\n") || "Автозадач нет");
  }, []);

  useEffect(() => {
    if (visible) void refreshAgent();
  }, [visible, refreshAgent]);

  const onAddTodo = useCallback(async () => {
    if (!todoDraft.trim()) return;
    await runTodoOps([{ action: "add", content: todoDraft.trim() }]);
    setTodoDraft("");
    void refreshAgent();
  }, [todoDraft, refreshAgent]);

  const onTodoStatus = useCallback(async (id: string, status: string) => {
    await runTodoOps([{ action: "update", id, status } as any]);
    void refreshAgent();
  }, [refreshAgent]);

  const onRemoveTodo = useCallback(async (id: string) => {
    await runTodoOps([{ action: "remove", id } as any]);
    void refreshAgent();
  }, [refreshAgent]);

  const onClearTodos = useCallback(async () => {
    await clearTodos();
    void refreshAgent();
  }, [refreshAgent]);

  const onClearMemory = useCallback(async () => {
    await clearMemory();
    setMemText("Память пуста.");
    showToast("ok", "Память очищена");
  }, []);

  const onAddJob = useCallback(async () => {
    if (!jobDraft.prompt.trim()) return;
    await upsertJob({
      name: jobDraft.name.trim() || jobDraft.prompt.slice(0, 30),
      schedule: jobDraft.schedule.trim() || "30m",
      prompt: jobDraft.prompt.trim(),
      deliver: "chat",
    });
    setJobDraft({ name: "", schedule: "30m", prompt: "" });
    void refreshAgent();
  }, [jobDraft, refreshAgent]);

  const onToggleJob = useCallback(async (id: string, enabled: boolean) => {
    await setJobEnabled(id, enabled);
    void refreshAgent();
  }, [refreshAgent]);

  const onRemoveJob = useCallback(async (id: string) => {
    await removeJob(id);
    void refreshAgent();
  }, [refreshAgent]);

  const activeProj =
    (activeProjectId ? projects.find((p) => p.id === activeProjectId) : null) ?? null;

  const load = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      const f: Record<string, number> = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            const t = await treeFiles(p.id);
            f[p.id] = t.trim().split("\n").filter((l) => l.trim()).length;
          } catch {
            f[p.id] = 0;
          }
        }),
      );
      setFileCounts(f);
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      load().finally(() => setLoading(false));
      setPath([]);
      setPreviewPath(null);
    }
  }, [visible, load]);

  useEffect(() => {
    if (path[0] === "instructions" && activeProj) {
      readFile(activeProj.id, INSTRUCTIONS_FILE)
        .then((c) => {
          setInstrText(c);
          setInstrDirty(false);
        })
        .catch(() => {
          setInstrText(`# Инструкции для агента — ${activeProj.name}\n\nОпиши здесь правила и контекст проекта.`);
          setInstrDirty(false);
        });
    }
  }, [path, activeProj]);

  const saveInstructions = useCallback(async () => {
    if (!activeProj) return;
    try {
      await writeFile(activeProj.id, INSTRUCTIONS_FILE, instrText);
      setInstrDirty(false);
      showToast("ok", "Инструкции сохранены");
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    }
  }, [activeProj, instrText]);

  const openPreview = useCallback(
    async (rel: string) => {
      if (!activeProj) return;
      try {
        const c = await readFile(activeProj.id, rel);
        setPreviewContent(c);
        setPreviewPath(rel);
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    },
    [activeProj],
  );

  const folderLabel = (p: string) => ROOT_FOLDERS.find((f) => f.key === p)?.label ?? p;
  const inRoot = path.length === 0;
  const inProjects = path[0] === "projects";
  const inSkills = path[0] === "skills";
  const inMemory = path[0] === "memory";
  const inTodo = path[0] === "todo";
  const inCron = path[0] === "cron";
  const inConnectors = path[0] === "connectors";

  const crumb = (i: number) => path.slice(0, i + 1).map(folderLabel).join(" / ");

  return (
    <Sheet visible={visible} onClose={onClose} title="Конфиг" snapPoints={["auto"]}>
      {/* хлебные крошки */}
      {path.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
          <Pressable onPress={() => setPath([])} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <MaterialIcons name="home" size={14} color={theme.accentHi} />
            <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: fonts.mono }}>Конфиг</Text>
          </Pressable>
          {path.map((seg, i) => (
            <React.Fragment key={seg}>
              <MaterialIcons name="chevron-right" size={13} color={theme.mute} />
              <Pressable onPress={() => setPath(path.slice(0, i + 1))} hitSlop={8}>
                <Text style={{ color: theme.dim, fontSize: 12, fontFamily: fonts.mono }}>{folderLabel(seg)}</Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* ── КОРЕНЬ: системные папки ── */}
      {inRoot && (
        <View style={{ marginTop: 6 }}>
          <View style={{ gap: 8 }}>
          {ROOT_FOLDERS.map((f) => (
            <GlassPressable
              key={f.key}
              radius={16}
              blur={false}
              onPress={() => setPath([f.key])}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingVertical: 13 }}
              accessibilityLabel={f.label}
            >
              <View style={{ width: 38, height: 38, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)" }}>
                <MaterialIcons name={f.icon} size={19} color={theme.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>{f.label}</Text>
                <Text style={{ color: theme.mute, fontSize: 11, marginTop: 1 }}>{f.desc}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
            </GlassPressable>
          ))}
          </View>
        </View>
      )}

      {/* ── ПРОЕКТЫ ── */}
      {inProjects && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Проекты» · {projects.length}
          </Text>
          {loading ? (
            <Text style={{ color: theme.dim, fontSize: 13, marginTop: 8 }}>Загрузка…</Text>
          ) : projects.length === 0 ? (
            <GlassPressable radius={16} blur={false} style={{ padding: 16 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                Проектов пока нет.
              </Text>
            </GlassPressable>
          ) : (
            <View style={{ gap: 8 }}>
              <Pressable
                onPress={() => onSelectProject(null)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                  borderRadius: 18, borderWidth: 1,
                  borderColor: !activeProj ? theme.accent : theme.border,
                  backgroundColor: !activeProj ? theme.accentDim : "transparent",
                }}
              >
                <MaterialIcons name="chat-bubble-outline" size={18} color={!activeProj ? theme.accentHi : theme.mute} />
                <Text style={{ flex: 1, color: !activeProj ? theme.accentHi : theme.text, fontSize: 13, fontWeight: "600" }}>Без проекта</Text>
                <Text style={{ color: theme.mute, fontSize: 10 }}>обычный чат</Text>
              </Pressable>
              {projects.map((p) => {
                const on = activeProjectId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => onSelectProject(p)}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                      borderRadius: 18, borderWidth: 1,
                      borderColor: on ? theme.accent : theme.border,
                      backgroundColor: on ? theme.accentDim : "transparent",
                    }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 18, backgroundColor: on ? theme.accentDim : theme.surface2, alignItems: "center", justifyContent: "center" }}>
                      <MaterialIcons name="folder" size={19} color={on ? theme.accentHi : theme.dim} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13.5, fontWeight: "500" }}>{p.name}</Text>
                      {p.desc ? <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{p.desc}</Text> : null}
                      <Text style={{ color: theme.mute, fontSize: 9.5, marginTop: 2, fontFamily: "monospace" }}>
                        {fileCounts[p.id] ?? 0} файлов
                      </Text>
                    </View>
                    {on && <MaterialIcons name="check-circle" size={17} color={theme.accentHi} />}
                    <Pressable onPress={() => setPath(["project-files", p.id])} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Файлы проекта">
                      <MaterialIcons name="insert-drive-file" size={16} color={theme.dim} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ── ФАЙЛЫ ПРОЕКТА ── */}
      {path[0] === "project-files" && (
        <ProjectFiles
          theme={theme}
          project={projects.find((p) => p.id === path[1]) ?? null}
          previewPath={previewPath}
          previewContent={previewContent}
          openPreview={openPreview}
          onBack={() => { setPath(["projects"]); setPreviewPath(null); setPreviewContent(""); }}
        />
      )}

      {/* ── СКИЛЛЫ (инструкции + самообучение + навыки — всё это скиллы) ── */}
      {inSkills && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Скиллы»
          </Text>
          {activeProj ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <MaterialIcons name="menu-book" size={15} color={theme.accentHi} />
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12.5, fontFamily: fonts.mono, flex: 1 }}>
                  {activeProj.name}/INSTRUCTIONS.md
                </Text>
              </View>
              <TextInput
                value={instrText}
                onChangeText={(t) => { setInstrText(t); setInstrDirty(true); }}
                multiline
                textAlignVertical="top"
                placeholder="Правила и контекст для агента…"
                placeholderTextColor={theme.mute}
                style={{
                  backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.6)",
                  borderColor: theme.border, borderWidth: 1,
                  borderRadius: 18, padding: 12, fontSize: 12.5, color: theme.codeText,
                  fontFamily: fonts.mono, lineHeight: 19, minHeight: 140,
                }}
              />
              <View style={{ marginTop: 10 }}>
                <Button title="Сохранить" onPress={saveInstructions} disabled={!instrDirty} fullWidth />
              </View>
            </>
          ) : (
            <GlassPressable radius={16} blur={false} style={{ padding: 16 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                Выбери проект, чтобы настроить инструкции (INSTRUCTIONS.md). Инструкции, самообучение и промпты — всё это навыки агента.
              </Text>
            </GlassPressable>
          )}
          <GlassPressable radius={16} blur={false} style={{ padding: 16, marginTop: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)", marginBottom: 10 }}>
              <MaterialIcons name="extension" size={20} color={theme.accentHi} />
            </View>
            <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 20 }}>
              Здесь агент хранит навыки: инструкции, самообучение (что узнал и записал), заготовки промптов. Всё сводится к скиллам — агент осваивает и переиспользует их.
            </Text>
          </GlassPressable>
        </View>
      )}

      {/* ── ПАМЯТЬ ── */}
      {inMemory && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Память»
          </Text>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 14 }}>
            <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 19, marginBottom: 10 }}>
              {memText.slice(0, 1500)}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Очистить память" variant="danger" onPress={onClearMemory} />
              <Button title="Обновить" variant="ghost" onPress={() => void refreshAgent()} />
            </View>
          </View>
        </View>
      )}

      {/* ── ЗАДАЧИ (todo) ── */}
      {inTodo && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Задачи» · {todoItems.length}
          </Text>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 14 }}>
            {todoItems.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 13, marginBottom: 8 }}>Задач нет.</Text>
            ) : (
              todoItems.map((t: any) => (
                <Pressable key={t.id} onPress={() => onTodoStatus(t.id, t.status === "completed" ? "pending" : "completed")}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, opacity: pressed ? 0.75 : 1 })}>
                  <MaterialIcons name={t.status === "completed" ? "check-circle" : "radio-button-unchecked"} size={18} color={t.status === "completed" ? theme.ok : theme.dim} />
                  <Text style={{ color: theme.text, fontSize: 13, flex: 1, textDecorationLine: t.status === "completed" ? "line-through" : "none", opacity: t.status === "completed" ? 0.55 : 1 }}>
                    {t.content}
                  </Text>
                  <Pressable onPress={() => onRemoveTodo(t.id)} hitSlop={8} style={{ padding: 2 }}>
                    <MaterialIcons name="close" size={16} color={theme.danger} />
                  </Pressable>
                </Pressable>
              ))
            )}
            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Input
                value={todoDraft}
                onChangeText={setTodoDraft}
                placeholder="Новая задача…"
                onSubmitEditing={onAddTodo}
                style={{ flex: 1 }}
              />
              <Button title="Добавить" variant="primary" onPress={onAddTodo} disabled={!todoDraft.trim()} />
            </View>
            {todoItems.length > 0 && (
              <Pressable onPress={onClearTodos} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                <Text style={{ color: theme.danger, fontSize: 12 }}>Очистить все</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* ── АВТОЗАДАЧИ (cron) ── */}
      {inCron && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Автозадачи» · {jobs.length}
          </Text>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 14 }}>
            {jobs.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 13, marginBottom: 8 }}>Автозадач нет. Пример: «каждый день в 9:00 напомни про зарядку».</Text>
            ) : (
              jobs.map((j: any) => (
                <View key={j.id} style={{ paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Switch
                    value={j.enabled}
                    onValueChange={(v) => onToggleJob(j.id, v)}
                    trackColor={{ false: theme.surface2, true: theme.accent }}
                    thumbColor={j.enabled ? "#fff" : theme.mute}
                    style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{j.name}</Text>
                    <Text style={{ color: theme.dim, fontSize: 11, fontFamily: fonts.mono }}>{j.schedule} · {j.prompt.slice(0, 40)}{j.prompt.length > 40 ? "…" : ""}</Text>
                  </View>
                  <Pressable onPress={() => onRemoveJob(j.id)} hitSlop={8} style={{ padding: 2 }}>
                    <MaterialIcons name="delete-outline" size={18} color={theme.danger} />
                  </Pressable>
                </View>
              ))
            )}
            {upcomingText && upcomingText !== "Автозадач нет" ? (
              <Text style={{ color: theme.accentHi, fontSize: 11, fontFamily: fonts.mono, marginTop: 4 }}>{upcomingText}</Text>
            ) : null}
            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
            <Text style={{ color: theme.dim, fontSize: 11.5, marginBottom: 6 }}>
              Расписание: «30m», «every 2h», «0 9 * * *» (cron) или дата ISO.
            </Text>
            <Input
              value={jobDraft.name}
              onChangeText={(v) => setJobDraft({ ...jobDraft, name: v })}
              placeholder="Название (необязательно)"
              style={{ marginBottom: 6 }}
            />
            <Input
              value={jobDraft.schedule}
              onChangeText={(v) => setJobDraft({ ...jobDraft, schedule: v })}
              placeholder="Расписание: 30m / every 2h / 0 9 * * *"
              autoCapitalize="none"
              style={{ marginBottom: 6, fontFamily: fonts.mono }}
            />
            <Input
              value={jobDraft.prompt}
              onChangeText={(v) => setJobDraft({ ...jobDraft, prompt: v })}
              placeholder="Что делать: текст задачи для агента…"
              style={{ marginBottom: 8, minHeight: 52 }}
            />
            <Button title="Создать автозадачу" variant="primary" onPress={onAddJob} disabled={!jobDraft.prompt.trim()} />
            <Pressable onPress={async () => { const msg = await runCurator(); showToast("info", msg.slice(0, 120)); void refreshAgent(); }} style={{ marginTop: 8, alignSelf: "flex-start" }}>
              <Text style={{ color: theme.accentHi, fontSize: 12 }}>Запустить куратора навыков</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── КОННЕКТОРЫ ── */}
      {inConnectors && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Коннекторы»
          </Text>
          <GlassPressable radius={16} blur={false} style={{ padding: 16 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)", marginBottom: 10 }}>
              <MaterialIcons name="link" size={20} color={theme.accentHi} />
            </View>
            <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 20 }}>
              Подключённые сервисы и инструменты агента: файлы, терминал, Telegram, внешние API. Новые коннекторы подключаются через агента.
            </Text>
          </GlassPressable>

          {/* Переустановка Linux-среды: чинит битые файлы старых установок */}
          <GlassPressable
            radius={16}
            blur={false}
            onPress={async () => {
              try {
                const { resetBootstrap } = await import("../../../modules/aso-runtime/src");
                const ok = await resetBootstrap();
                showToast(ok ? "ok" : "err", ok ? "Среда сброшена — перезапустите приложение" : "Не удалось сбросить среду");
              } catch (e: any) {
                showToast("err", `Ошибка: ${e?.message || "не удалось"}`);
              }
            }}
            style={{ padding: 16, marginTop: 8 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)" }}>
                <MaterialIcons name="restart-alt" size={20} color={theme.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>Переустановить среду</Text>
                <Text style={{ color: theme.mute, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>
                  Заново распакует встроенный Linux при следующей команде. Помогает, если команды падают с 126 (битые файлы от старых версий).
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
            </View>
          </GlassPressable>
        </View>
      )}
    </Sheet>
  );
}

/* ── Файлы проекта ── */
function ProjectFiles({
  theme, project, previewPath, previewContent, openPreview, onBack,
}: {
  theme: any;
  project: VibeProject | null;
  previewPath: string | null;
  previewContent: string;
  openPreview: (rel: string) => void;
  onBack: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (project) {
      treeFiles(project.id)
        .then((t) => setFiles(t.trim().split("\n").map((l) => l.trim()).filter(Boolean)))
        .catch(() => setFiles([]));
    }
  }, [project]);

  return (
    <View style={{ marginTop: 6 }}>
      {!project ? (
        <Text style={{ color: theme.dim, fontSize: 13 }}>Проект не найден.</Text>
      ) : !previewPath ? (
        <>
          <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 4 }}>
            {project.name} · {files.length} записей
          </Text>
          {files.length === 0 && (
            <GlassPressable radius={16} blur={false} style={{ padding: 16 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                В папке пока пусто.
              </Text>
            </GlassPressable>
          )}
          <View style={{ gap: 6 }}>
          {files.map((f, i) => {
            const isDir = !f.match(/\.[a-zA-Z0-9]+$/);
            const name = f.split("/").pop();
            return (
              <Pressable
                key={i}
                onPress={() => !isDir && openPreview(f)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10, padding: 11,
                  borderRadius: 18, borderWidth: 1, borderColor: theme.border,
                  backgroundColor: "transparent",
                }}
              >
                <MaterialIcons name={isDir ? "folder" : "insert-drive-file"} size={17} color={isDir ? theme.warn : theme.accentHi} />
                <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 12.5, fontFamily: "monospace" }}>{name}</Text>
                {!isDir && <MaterialIcons name="visibility" size={14} color={theme.mute} />}
              </Pressable>
            );
          })}
          </View>
        </>
      ) : (
        <>
          <Pressable onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <MaterialIcons name="arrow-back" size={15} color={theme.accentHi} />
            <Text style={{ color: theme.accentHi, fontSize: 12.5, fontFamily: fonts.mono }}>{previewPath}</Text>
          </Pressable>
          <View style={{ backgroundColor: theme.codeBg, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 12 }}>
            <Text selectable style={{ color: theme.codeText, fontSize: 12, fontFamily: fonts.mono, lineHeight: 18 }}>
              {previewContent}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
