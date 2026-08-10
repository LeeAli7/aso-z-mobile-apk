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
import { Alert, Pressable, Switch, Text, TextInput, View } from "react-native";
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
import { listSkills, viewSkill, saveSkill, deleteSkill } from "../../core/skills";
import { runCommandCapture, runtimeAvailable } from "../../core/runtime";

const INSTRUCTIONS_FILE = "INSTRUCTIONS.md";

/** Путь в корневой папке: [] = корень, ["projects"], ["instructions"] … */
type Path = string[];

const ROOT_FOLDERS: { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; desc: string }[] = [
  { key: "storage", label: "Хранилище", icon: "storage", desc: "файлы и папки рабочей среды агента" },
  { key: "skills", label: "Скиллы", icon: "extension", desc: "навыки агента (SKILL.md), управление" },
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
  const inStorage = path[0] === "storage";
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

      {/* ── ХРАНИЛИЩЕ: файлы рабочей среды агента + проект сессии ── */}
      {inStorage && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Хранилище» · workspace агента
          </Text>

          {/* файловый менеджер реальной файловой системы агента (workspace) */}
          <WorkspaceFiles theme={theme} />

          {/* выбор проекта-контекста сессии (vibe-проекты) */}
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginTop: 14, marginBottom: 4 }}>
            Проект сессии · {projects.length}
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
          onBack={() => { setPath(["storage"]); setPreviewPath(null); setPreviewContent(""); }}
        />
      )}

      {/* ── СКИЛЛЫ: управление навыками (список/создать/редактировать/удалить) ── */}
      {inSkills && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Папка «Скиллы»
          </Text>
          <SkillsManager theme={theme} />
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

/* ── Менеджер скиллов (Конфиг → Скиллы): список/просмотр/создание/редактирование/удаление ── */
function SkillsManager({ theme }: { theme: any }) {
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [mode, setMode] = useState<"list" | "form" | "view">("list");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [viewBody, setViewBody] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", body: "" });

  const refresh = useCallback(async () => {
    setSkills(await listSkills().catch(() => []));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const startCreate = () => {
    setEditingName(null);
    setDraft({ name: "", description: "", body: "" });
    setMode("form");
  };

  const startEdit = async (name: string) => {
    const body = await viewSkill(name).catch(() => "");
    // убираем frontmatter при редактировании
    const m = body.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
    const clean = m ? m[1].trim() : body;
    const desc = skills.find((s) => s.name === name)?.description ?? "";
    setEditingName(name);
    setDraft({ name, description: desc, body: clean });
    setMode("form");
  };

  const openView = async (name: string) => {
    const body = await viewSkill(name).catch(() => "(не удалось прочитать)");
    setViewBody(body);
    setMode("view");
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim()) {
      showToast("err", "Заполни имя и тело навыка");
      return;
    }
    const name = draft.name.trim().toLowerCase().replace(/\s+/g, "_");
    const msg = await saveSkill(name, draft.description.trim(), draft.body.trim());
    showToast(msg.startsWith("Навык") ? "ok" : "err", msg.slice(0, 120));
    setMode("list");
    setEditingName(null);
    setDraft({ name: "", description: "", body: "" });
    void refresh();
  };

  const del = async (name: string) => {
    Alert.alert("Удалить навык", `«${name}» будет удалён безвозвратно.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить", style: "destructive",
        onPress: async () => {
          const msg = await deleteSkill(name);
          showToast(msg.startsWith("Навык") ? "ok" : "err", msg.slice(0, 120));
          void refresh();
        },
      },
    ]);
  };

  const input = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 12,
    backgroundColor: theme.surface2, color: theme.text, fontSize: 12.5,
    paddingHorizontal: 10, paddingVertical: 8,
  };

  if (mode === "form") {
    return (
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 12 }}>
        <Text style={{ color: theme.dim, fontSize: 12, marginBottom: 8 }}>
          {editingName ? `Редактирование «${editingName}»` : "Новый навык"}
        </Text>
        <TextInput value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="имя (латиница/дефисы)" placeholderTextColor={theme.mute} autoCapitalize="none" style={[input, { fontFamily: fonts.mono }]} />
        <View style={{ height: 6 }} />
        <TextInput value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })} placeholder="описание (по чему искать)" placeholderTextColor={theme.mute} style={input} />
        <View style={{ height: 6 }} />
        <TextInput value={draft.body} onChangeText={(v) => setDraft({ ...draft, body: v })} placeholder="тело навыка: шаги, команды, питфоллы" placeholderTextColor={theme.mute} multiline textAlignVertical="top" style={[input, { minHeight: 110 }]} />
        <View style={{ height: 10 }} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Отмена" variant="secondary" onPress={() => setMode("list")} fullWidth /></View>
          <View style={{ flex: 1 }}><Button title="Сохранить" variant="primary" onPress={save} fullWidth /></View>
        </View>
      </View>
    );
  }

  if (mode === "view") {
    return (
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ color: theme.accentHi, fontSize: 11, fontFamily: fonts.mono }}>SKILL.md</Text>
          <Pressable onPress={() => setMode("list")} hitSlop={8}><Text style={{ color: theme.dim, fontSize: 11 }}>назад</Text></Pressable>
        </View>
        <Text selectable style={{ color: theme.codeText, fontSize: 11.5, fontFamily: fonts.mono, lineHeight: 17 }}>
          {viewBody}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 12 }}>
      {skills.length === 0 ? (
        <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 10 }}>Навыков пока нет. Агент создаёт их сам после сложных задач — каждый в отдельном SKILL.md.</Text>
      ) : (
        skills.map((s) => (
          <View key={s.name} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 6 }}>
            <Pressable onPress={() => openView(s.name)} style={{ flex: 1 }} android_ripple={{ color: theme.ripple }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600", fontFamily: fonts.mono }}>{s.name}</Text>
              <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, marginTop: 1 }}>{s.description}</Text>
            </Pressable>
            <Pressable onPress={() => startEdit(s.name)} hitSlop={8} style={{ padding: 4 }}>
              <MaterialIcons name="edit" size={16} color={theme.dim} />
            </Pressable>
            <Pressable onPress={() => del(s.name)} hitSlop={8} style={{ padding: 4 }}>
              <MaterialIcons name="delete-outline" size={17} color={theme.danger} />
            </Pressable>
          </View>
        ))
      )}
      <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
      <Button title="Новый навык" variant="primary" onPress={startCreate} fullWidth />
      <View style={{ height: 8 }} />
      <Button title="Запустить куратора (архив старых)" variant="ghost" fullWidth onPress={async () => {
        const msg = await runCurator();
        showToast("info", msg.slice(0, 120));
        void refresh();
      }} />
    </View>
  );
}

/* ── Файловый менеджер workspace агента (реальная ФС: $PREFIX/home) ── */
function WorkspaceFiles({ theme }: { theme: any }) {
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<{ name: string; isDir: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<"dir" | "file" | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // относительный путь файла
  const [editContent, setEditContent] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const relPath = path.join("/");
  // безопасное экранирование сегмента пути (одинарные кавычки)
  const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  const target = path.map(q).join("/");

  const refresh = useCallback(async () => {
    if (!runtimeAvailable()) { setEntries([]); return; }
    setLoading(true);
    try {
      const cd = relPath ? `cd ${target}` : "";
      const r = await runCommandCapture(`${cd}; for f in * .[!.]*; do [ -e "$f" ] || continue; if [ -d "$f" ]; then echo "D:$f"; else echo "F:$f"; fi; done`, undefined);
      const es = (r.output || "").split("\n").filter((l) => l.length > 2)
        .map((l) => ({ name: l.slice(2), isDir: l[0] === "D" }))
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      setEntries(es);
    } catch {} finally { setLoading(false); }
  }, [relPath, target]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (cmd: string): Promise<boolean> => {
    const r = await runCommandCapture(cmd, undefined);
    if (!r.ok) showToast("err", (r.output?.trim() || r.error || "ошибка").slice(0, 140));
    return r.ok;
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const ok = creating === "dir"
      ? await run(`mkdir -p ${target ? `${target}/` : ""}${q(name)}`)
      : await run(`echo ${utf8ToB64("")} | base64 -d > ${target ? `${target}/` : ""}${q(name)}`);
    if (ok) { setNewName(""); setCreating(null); void refresh(); }
  };

  const openEditor = async (name: string) => {
    const r = await runCommandCapture(`cat ${target ? `${target}/` : ""}${q(name)}`, undefined);
    setEditContent(r.output ?? "");
    setEditing(name);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await run(`echo ${utf8ToB64(editContent)} | base64 -d > ${target ? `${target}/` : ""}${q(editing)}`);
    if (ok) { setEditing(null); showToast("ok", "Файл сохранён"); void refresh(); }
  };

  const doRename = async () => {
    const name = renameValue.trim();
    if (!renaming || !name) return;
    const ok = await run(`mv ${target ? `${target}/` : ""}${q(renaming)} ${target ? `${target}/` : ""}${q(name)}`);
    if (ok) { setRenaming(null); setRenameValue(""); void refresh(); }
  };

  const doDelete = async (name: string, isDir: boolean) => {
    Alert.alert("Удалить", `«${name}» будет удалён${isDir ? " вместе с содержимым" : ""}.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить", style: "destructive",
        onPress: async () => {
          const ok = await run(`rm ${isDir ? "-rf" : "-f"} ${target ? `${target}/` : ""}${q(name)}`);
          if (ok) void refresh();
        },
      },
    ]);
  };

  if (!runtimeAvailable()) {
    return (
      <GlassPressable radius={16} blur={false} style={{ padding: 16 }}>
        <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
          Файлы рабочей среды видны только на Android (встроенный Linux-рантайм).
        </Text>
      </GlassPressable>
    );
  }

  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.6)", padding: 12 }}>
      {/* путь */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        <Pressable onPress={() => setPath([])} hitSlop={6}>
          <Text style={{ color: theme.accentHi, fontSize: 11, fontFamily: fonts.mono }}>~/</Text>
        </Pressable>
        {path.map((seg, i) => (
          <React.Fragment key={seg + i}>
            <MaterialIcons name="chevron-right" size={11} color={theme.mute} />
            <Pressable onPress={() => setPath(path.slice(0, i + 1))} hitSlop={6}>
              <Text style={{ color: theme.dim, fontSize: 11, fontFamily: fonts.mono }}>{seg}</Text>
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      {/* создание */}
      {creating ? (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder={creating === "dir" ? "имя папки" : "имя файла"}
            placeholderTextColor={theme.mute}
            autoFocus
            autoCapitalize="none"
            onSubmitEditing={doCreate}
            style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.surface2, color: theme.text, fontSize: 12.5, paddingHorizontal: 10, paddingVertical: 7, fontFamily: fonts.mono }}
          />
          <Button title="OK" variant="primary" onPress={doCreate} />
          <Button title="✕" variant="secondary" onPress={() => setCreating(null)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
          <Button title="+ Папка" variant="secondary" onPress={() => setCreating("dir")} />
          <Button title="+ Файл" variant="secondary" onPress={() => setCreating("file")} />
        </View>
      )}

      {loading ? <Text style={{ color: theme.dim, fontSize: 12, marginBottom: 6 }}>Загрузка…</Text> : null}

      {entries.length === 0 && !loading ? (
        <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 8 }}>Папка пуста.</Text>
      ) : (
        entries.map((e) => (
          <View key={e.name} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
            {renaming === e.name ? (
              <>
                <TextInput
                  value={renameValue}
                  onChangeText={setRenameValue}
                  autoFocus
                  autoCapitalize="none"
                  onSubmitEditing={doRename}
                  style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.surface2, color: theme.text, fontSize: 12.5, paddingHorizontal: 10, paddingVertical: 5, fontFamily: fonts.mono }}
                />
                <Button title="OK" variant="primary" onPress={doRename} />
                <Button title="✕" variant="secondary" onPress={() => setRenaming(null)} />
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => (e.isDir ? setPath([...path, e.name]) : openEditor(e.name))}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <MaterialIcons name={e.isDir ? "folder" : fileKindIcon(e.name)} size={16} color={e.isDir ? theme.warn : theme.accentHi} />
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12.5, fontFamily: fonts.mono, flexShrink: 1 }}>{e.name}</Text>
                </Pressable>
                <Pressable onPress={() => { setRenaming(e.name); setRenameValue(e.name); }} hitSlop={8} style={{ padding: 3 }}>
                  <MaterialIcons name="edit" size={15} color={theme.dim} />
                </Pressable>
                <Pressable onPress={() => doDelete(e.name, e.isDir)} hitSlop={8} style={{ padding: 3 }}>
                  <MaterialIcons name="delete-outline" size={16} color={theme.danger} />
                </Pressable>
              </>
            )}
          </View>
        ))
      )}

      {/* редактор файла */}
      {editing && (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
          <Text style={{ color: theme.dim, fontSize: 11, fontFamily: fonts.mono, marginBottom: 6 }}>{editing}</Text>
          <TextInput
            value={editContent}
            onChangeText={setEditContent}
            multiline
            textAlignVertical="top"
            placeholder="содержимое файла…"
            placeholderTextColor={theme.mute}
            style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.codeBg, color: theme.codeText, fontSize: 12, fontFamily: fonts.mono, lineHeight: 17, minHeight: 120, padding: 10 }}
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Button title="Отмена" variant="secondary" onPress={() => setEditing(null)} fullWidth /></View>
            <View style={{ flex: 1 }}><Button title="Сохранить" variant="primary" onPress={saveEdit} fullWidth /></View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Иконка файла по расширению (для хранилища). */
function fileKindIcon(name: string): "archive" | "description" | "insert-drive-file" | "image" | "code" {
  const ext = (name || "").split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst"].includes(ext)) return "archive";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return "image";
  if (["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "css", "html", "json", "sh", "bash", "yaml", "yml", "toml"].includes(ext)) return "code";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "csv", "log"].includes(ext)) return "description";
  return "insert-drive-file";
}

/** UTF-8 → base64 (RN-safe, без Buffer). */
function utf8ToB64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    return btoa(unescape(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))));
  }
}
