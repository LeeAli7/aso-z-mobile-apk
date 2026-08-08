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
import { Pressable, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../../store/AppStore";
import { Sheet } from "../../design-system/components/Sheet";
import { GlassPressable } from "../../design-system/components/Glass";
import { Button } from "../../design-system/components/Button";
import { fonts } from "../../theme/tokens";
import {
  VibeProject,
  listProjects,
  treeFiles,
  readFile,
  writeFile,
} from "../../core/vibeLocal";
import { showToast } from "../../design-system/components/Toast";

const INSTRUCTIONS_FILE = "INSTRUCTIONS.md";

/** Путь в корневой папке: [] = корень, ["projects"], ["instructions"] … */
type Path = string[];

const ROOT_FOLDERS: { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; desc: string }[] = [
  { key: "projects", label: "Проекты", icon: "folder", desc: "папки-проекты агента" },
  { key: "skills", label: "Скиллы", icon: "extension", desc: "навыки, инструкции, самообучение" },
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
