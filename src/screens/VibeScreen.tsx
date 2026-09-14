/**
 * Хранилище — внутреннее хранилище агента, корень-список отделов-подокон.
 *
 * Отделы: Проекты / Файлы агента / Память / Задачи / Автозадачи / Скиллы.
 * Корень — только список со стрелками и значками (Dept), внутри — контролы.
 * Файлы/папки/проекты в приоритете создаёт сам агент; ручное — вторично.
 *
 * NATIVE OWNER (Арес): движок (vibeLocal/memory/todo/cron/skills) —
 * заменить вызовы ниже на движок, UI не менять.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { TextField } from "../components/ui";
import { IconButton } from "../design-system/components/IconButton";
import { EmptyState } from "../design-system/components/EmptyState";
import { Sheet } from "../design-system/components/Sheet";
import { Button } from "../design-system/components/Button";
import { showToast } from "../design-system/components/Toast";
import { DeptRow, DeptDivider, DeptBack, DeptDef } from "../components/Dept";
import {
  VibeProject,
  VibeFileEntry,
  createProject,
  deleteProject,
  listFiles,
  listProjects,
  renameProject,
} from "../core/vibeLocal";
import { memorySnapshot, clearMemory } from "../core/memory";
import { loadTodos, runTodoOps, clearTodos, TodoItem } from "../core/todo";
import { loadJobs, removeJob, setJobEnabled, CronJob } from "../core/cron";
import { listSkills } from "../core/skills";

type DeptKey = "projects" | "files" | "memory" | "todos" | "cron" | "skills";

export function VibeScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [dept, setDept] = useState<DeptKey | null>(null);

  // ── проекты ──
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [menuProject, setMenuProject] = useState<VibeProject | null>(null);
  const [renameText, setRenameText] = useState("");

  // ── файлы агента (агрегат по проектам) ──
  const [allFiles, setAllFiles] = useState<{ project: string; entries: VibeFileEntry[] }[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // ── память / задачи / автозадачи / скиллы ──
  const [memText, setMemText] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await listProjects();
      // подмешиваем счётчик файлов
      const withFiles = await Promise.all(
        list.map(async (p) => {
          const files = await listFiles(p.id).catch(() => []);
          return { ...p, fileCount: files.length };
        }),
      );
      setProjects(withFiles as any);
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const list = await listProjects();
      const agg = await Promise.all(
        list.map(async (p) => ({
          project: p.name,
          entries: await listFiles(p.id).catch(() => []),
        })),
      );
      setAllFiles(agg.filter((a) => a.entries.length > 0));
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const loadAgent = useCallback(async () => {
    setMemText((await memorySnapshot().catch(() => "")) || "Память пуста.");
    setTodos(await loadTodos().catch(() => []));
    setJobs(await loadJobs().catch(() => []));
    setSkills(await listSkills().catch(() => []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (dept === "files") void loadFiles();
    if (dept === "memory" || dept === "todos" || dept === "cron" || dept === "skills") void loadAgent();
  }, [dept, loadFiles, loadAgent]);

  const create = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      const p = await createProject(n, desc);
      setName("");
      setDesc("");
      setCreateOpen(false);
      navigation.navigate("VibeProject", { id: p.id, name: p.name });
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setCreating(false);
      load();
    }
  }, [name, desc, navigation, load]);

  const remove = useCallback(
    (p: VibeProject) => {
      Alert.alert(t("delete"), `Удалить проект «${p.name}» и все файлы?`, [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteProject(p.id);
              showToast("ok", "Проект удалён");
              load();
            } catch (e: any) {
              showToast("err", String(e?.message || e));
            }
          },
        },
      ]);
    },
    [load, t],
  );

  // Корень = ПРОВОДНИК рабочей среды: сначала проекты и файлы агента,
  // затем отделы агента внутри (память/задачи/автозадачи/скиллы — не корень).
  const explorerDepts: (DeptDef & { key: DeptKey })[] = [
    { key: "projects", title: t("dept_projects"), sub: `${projects.length}`, icon: "folder" },
    { key: "files", title: t("dept_agent_files"), icon: "file" },
  ];
  const agentDepts: (DeptDef & { key: DeptKey })[] = [
    { key: "memory", title: t("grp_memory"), icon: "bulb" },
    { key: "todos", title: t("dept_todos"), sub: `${todos.length}`, icon: "check" },
    { key: "cron", title: t("dept_cron"), sub: `${jobs.length}`, icon: "clock" },
    { key: "skills", title: t("dept_skills"), sub: `${skills.length}`, icon: "model" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <IconButton name="arrow-left" size={20} onPress={() => (dept ? setDept(null) : navigation.goBack())} accessibilityLabel={t("back")} />
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Text style={{ color: theme.dim, fontSize: 11 }}>{t("vibe_sub")}</Text>
          <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.3 }}>{t("vibe_title")}</Text>
        </View>
        {/* ручное создание — вторично, через меню */}
        {dept === "projects" && (
          <IconButton
            name="plus"
            size={20}
            onPress={() => setCreateOpen(true)}
            haptic
            accessibilityLabel={t("manual_create")}
          />
        )}
      </View>

      {/* корень = проводник: проекты и файлы первыми, отделы агента — ниже внутри */}
      {dept === null && (
        <View style={{ padding: 16 }}>
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            {explorerDepts.map((d, i) => (
              <View key={d.key}>
                {i > 0 && <DeptDivider theme={theme} />}
                <DeptRow dept={d} theme={theme} onPress={() => setDept(d.key)} />
              </View>
            ))}
          </View>
          <Text style={{ color: theme.mute, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 6, marginHorizontal: 4 }}>
            {t("grp_agent")}
          </Text>
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            {agentDepts.map((d, i) => (
              <View key={d.key}>
                {i > 0 && <DeptDivider theme={theme} />}
                <DeptRow dept={d} theme={theme} onPress={() => setDept(d.key)} />
              </View>
            ))}
          </View>
        </View>
      )}

      {dept !== null && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <DeptBack theme={theme} label={t("back")} onPress={() => setDept(null)} />
        </View>
      )}

      {/* ── Проекты (существующий список, без изменений логики) ── */}
      {dept === "projects" && (
        loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.dim, fontSize: 13 }}>…</Text>
          </View>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="folder"
            title={t("storage_empty_title")}
            subtitle={t("storage_empty_sub")}
          />
        ) : (
          <FlatList
            data={projects}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => navigation.navigate("VibeProject", { id: item.id, name: item.name })}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 11,
                  padding: 13,
                  borderRadius: 13,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                  marginBottom: 10,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: theme.accentDim, alignItems: "center", justifyContent: "center" }}>
                  <AppIcon name="folder" size={20} color={theme.accentHi} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: "500" }}>{item.name}</Text>
                  {item.desc ? (
                    <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, marginTop: 1 }}>{item.desc}</Text>
                  ) : null}
                  <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2, fontFamily: "monospace" }}>
                    {(item as any).fileCount ?? 0} файлов · {new Date(item.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <IconButton
                  name="more"
                  size={18}
                  onPress={() => { setMenuProject(item); setRenameText(item.name); }}
                  haptic
                  accessibilityLabel="Меню проекта"
                />
              </Pressable>
            )}
          />
        )
      )}

      {/* ── Файлы агента (агрегат по проектам, read-only) ── */}
      {dept === "files" && (
        <FlatList
          data={allFiles}
          keyExtractor={(a) => a.project}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <Text style={{ color: theme.dim, fontSize: 12.5, textAlign: "center", marginTop: 24 }}>
              {filesLoading ? "…" : t("storage_empty_sub")}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.mute, fontSize: 10, letterSpacing: 1.2, marginBottom: 6 }}>
                {item.project.toUpperCase()} · {item.entries.length}
              </Text>
              {item.entries.map((f) => (
                <View key={f.name} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}>
                  <AppIcon name="file" size={16} color={theme.accentHi} />
                  <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 12.5, fontFamily: "monospace" }}>{f.name}</Text>
                  <Text style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>{f.size} B</Text>
                </View>
              ))}
            </View>
          )}
        />
      )}

      {/* ── Память (read + очистка) ── */}
      {dept === "memory" && (
        <View style={{ padding: 16 }}>
          <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 19 }}>{memText.slice(0, 1500)}</Text>
            <View style={{ height: 10 }} />
            <Button
              title={t("delete")}
              variant="danger"
              onPress={() => {
                Alert.alert(t("grp_memory"), t("cancel"), [
                  { text: t("cancel"), style: "cancel" },
                  {
                    text: t("delete"), style: "destructive",
                    onPress: async () => { await clearMemory(); setMemText("Память пуста."); },
                  },
                ]);
              }}
            />
          </View>
        </View>
      )}

      {/* ── Задачи (todo) ── */}
      {dept === "todos" && (
        <View style={{ padding: 16 }}>
          {todos.length === 0 ? (
            <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 10 }}>{t("kb_empty")}</Text>
          ) : todos.map((td) => (
            <Pressable
              key={td.id}
              onPress={async () => {
                await runTodoOps([{ action: "update", id: td.id, status: td.status === "completed" ? "pending" : "completed" }]);
                setTodos(await loadTodos().catch(() => []));
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}
            >
              <AppIcon name={td.status === "completed" ? "check-circle" : "circle"} size={17} color={td.status === "completed" ? theme.ok : theme.dim} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 13, textDecorationLine: td.status === "completed" ? "line-through" : "none", opacity: td.status === "completed" ? 0.55 : 1 }}>
                {td.content}
              </Text>
              <Pressable
                onPress={async () => {
                  await runTodoOps([{ action: "remove", id: td.id }]);
                  setTodos(await loadTodos().catch(() => []));
                }}
                hitSlop={8} style={{ padding: 4 }}
              >
                <AppIcon name="close" size={14} color={theme.danger} />
              </Pressable>
            </Pressable>
          ))}
          <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextField value={todoDraft} onChangeText={setTodoDraft} placeholder={t("kb_add_ph")} />
            <Button
              title={t("create")}
              variant="primary"
              onPress={async () => {
                if (!todoDraft.trim()) return;
                await runTodoOps([{ action: "add", content: todoDraft.trim() }]);
                setTodoDraft("");
                setTodos(await loadTodos().catch(() => []));
              }}
              disabled={!todoDraft.trim()}
            />
          </View>
          {todos.length > 0 && (
            <Pressable
              onPress={async () => { await clearTodos(); setTodos([]); }}
              style={{ marginTop: 8, alignSelf: "flex-start" }}
            >
              <Text style={{ color: theme.danger, fontSize: 12 }}>{t("delete")}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── Автозадачи (cron, read + вкл/выкл/удалить) ── */}
      {dept === "cron" && (
        <View style={{ padding: 16 }}>
          {jobs.length === 0 ? (
            <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 8 }}>{t("kb_empty")}</Text>
          ) : jobs.map((j) => (
            <View key={j.id} style={{ paddingVertical: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}>
              <Pressable
                onPress={async () => {
                  await setJobEnabled(j.id, !j.enabled);
                  setJobs(await loadJobs().catch(() => []));
                }}
                hitSlop={8}
              >
                <AppIcon name={j.enabled ? "check-circle" : "circle"} size={17} color={j.enabled ? theme.ok : theme.dim} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{j.name}</Text>
                <Text style={{ color: theme.dim, fontSize: 11, fontFamily: "monospace" }}>{j.schedule}</Text>
              </View>
              <Pressable
                onPress={async () => {
                  await removeJob(j.id);
                  setJobs(await loadJobs().catch(() => []));
                }}
                hitSlop={8} style={{ padding: 2 }}
              >
                <AppIcon name="delete" size={17} color={theme.danger} />
              </Pressable>
            </View>
          ))}
          <Text style={{ color: theme.mute, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
            Создание — через AgentSettings или чат.
          </Text>
        </View>
      )}

      {/* ── Скиллы (read-only список) ── */}
      {dept === "skills" && (
        <View style={{ padding: 16 }}>
          {skills.length === 0 ? (
            <Text style={{ color: theme.dim, fontSize: 12.5 }}>Навыков пока нет. Агент создаёт их сам после сложных задач.</Text>
          ) : skills.map((s) => (
            <View key={s.name} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600", fontFamily: "monospace" }}>{s.name}</Text>
              <Text style={{ color: theme.dim, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{s.description}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ручное создание проекта — вторично, через меню «＋» */}
      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title={t("manual_create")} snapPoints={["40%"]}>
        <TextField value={name} onChangeText={setName} placeholder={t("project_name")} />
        <View style={{ height: 8 }} />
        <TextField value={desc} onChangeText={setDesc} placeholder={t("project_desc")} />
        <View style={{ height: 10 }} />
        <Button title={t("create")} variant="primary" fullWidth onPress={create} disabled={creating || !name.trim()} />
      </Sheet>

      {/* project menu sheet */}
      <Sheet visible={!!menuProject} onClose={() => setMenuProject(null)} title={menuProject?.name ?? ""} snapPoints={["40%"]}>
        {menuProject && (
          <View style={{ gap: 8 }}>
            <Button
              title={t("export_title")}
              variant="secondary"
              fullWidth
              onPress={async () => {
                // Экспорт проводника: дерево проекта текстом через Share.
                // NATIVE OWNER (Арес): exportProject/exportFolder (zip) из
                // documentDirectory/vibe — заменить текст на zip-файл.
                try {
                  const { treeFiles: tree } = await import("../core/vibeLocal");
                  const tree_ = await tree(menuProject.id).catch(() => "");
                  const body = `${menuProject.name}\n${"=".repeat(menuProject.name.length)}\n${tree_ || "(пусто)"}`;
                  await Share.share({ message: body, title: menuProject.name });
                } catch (e: any) {
                  showToast("err", String(e?.message || e));
                }
                setMenuProject(null);
              }}
            />
            <Button
              title="Переименовать"
              variant="secondary"
              fullWidth
              onPress={async () => {
                if (renameText.trim() && renameText.trim() !== menuProject.name) {
                  try {
                    await renameProject(menuProject.id, renameText.trim());
                    showToast("ok", "Проект переименован");
                  } catch (e: any) {
                    showToast("err", String(e?.message || e));
                  }
                }
                setMenuProject(null);
                load();
              }}
            />
            <Button title={t("delete")} variant="danger" fullWidth onPress={() => { remove(menuProject); setMenuProject(null); }} />
          </View>
        )}
      </Sheet>
    </View>
  );
}
