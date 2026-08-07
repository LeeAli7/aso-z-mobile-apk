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
  { key: "instructions", label: "Инструкции", icon: "menu-book", desc: "правила и контекст" },
  { key: "selflearn", label: "Самообучение", icon: "auto-stories", desc: "память агента" },
  { key: "prompts", label: "Промпты", icon: "text-snippet", desc: "заготовки запросов" },
  { key: "skills", label: "Скиллы", icon: "extension", desc: "навыки агента" },
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
  const inInstructions = path[0] === "instructions";
  const inSelflearn = path[0] === "selflearn";
  const inPrompts = path[0] === "prompts";
  const inSkills = path[0] === "skills";

  const crumb = (i: number) => path.slice(0, i + 1).map(folderLabel).join(" / ");

  return (
    <Sheet visible={visible} onClose={onClose} title="Хранилище" snapPoints={["82%"]}>
      {/* хлебные крошки */}
      {path.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
          <Pressable onPress={() => setPath([])} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <MaterialIcons name="home" size={14} color={theme.accentHi} />
            <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: fonts.mono }}>Хранилище</Text>
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
          <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Корневая папка
          </Text>
          {ROOT_FOLDERS.map((f) => (
            <GlassPressable
              key={f.key}
              radius={16}
              intensity={32}
              onPress={() => setPath([f.key])}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingVertical: 13, marginTop: 8 }}
              accessibilityLabel={f.label}
            >
              <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)" }}>
                <MaterialIcons name={f.icon} size={19} color={theme.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>{f.label}</Text>
                <Text style={{ color: theme.mute, fontSize: 11, marginTop: 1 }}>{f.desc}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
            </GlassPressable>
          ))}

          <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 14, lineHeight: 15 }}>
            Скажи агенту «создай проект …» — он сам создаст папку и наполнит её файлами.
          </Text>
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
            <GlassPressable radius={16} intensity={30} style={{ padding: 16, marginTop: 8 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                Проектов пока нет. Скажи агенту: «создай проект “Мой сайт”» — он создаст папку, опишет проект и сохранит файлы сюда.
              </Text>
            </GlassPressable>
          ) : (
            <>
              <Pressable
                onPress={() => onSelectProject(null)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                  borderRadius: 13, borderWidth: 1, marginTop: 8,
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
                      borderRadius: 13, borderWidth: 1, marginTop: 8,
                      borderColor: on ? theme.accent : theme.border,
                      backgroundColor: on ? theme.accentDim : "transparent",
                    }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: on ? theme.accentDim : theme.surface2, alignItems: "center", justifyContent: "center" }}>
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
                    <Pressable onPress={() => setPath(["project-files", p.id])} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Файлы проекта">
                      <MaterialIcons name="insert-drive-file" size={16} color={theme.dim} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </>
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

      {/* ── ИНСТРУКЦИИ ── */}
      {inInstructions && (
        <View style={{ marginTop: 6 }}>
          {!activeProj ? (
            <GlassPressable radius={16} intensity={30} style={{ padding: 16, marginTop: 8 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                Выбери проект, чтобы настроить его инструкции (INSTRUCTIONS.md).
              </Text>
            </GlassPressable>
          ) : (
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
                  borderRadius: 12, padding: 12, fontSize: 12.5, color: theme.codeText,
                  fontFamily: fonts.mono, lineHeight: 19, minHeight: 190,
                }}
              />
              <View style={{ marginTop: 10 }}>
                <Button title="Сохранить инструкции" onPress={saveInstructions} disabled={!instrDirty} fullWidth />
              </View>
              <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 8, lineHeight: 15 }}>
                Файл автоматически подключается в контекст агента при работе в этом проекте.
              </Text>
            </>
          )}
        </View>
      )}

      {/* ── САМООБУЧЕНИЕ / ПРОМПТЫ / СКИЛЛЫ (концепция) ── */}
      {(inSelflearn || inPrompts || inSkills) && (
        <ConceptFolder
          theme={theme}
          label={folderLabel(path[0])}
          hint={
            inSelflearn
              ? "Здесь агент будет хранить то, что узнал и записал: заметки, выводы, «уроки» из работы с тобой. Агент сам пополняет эту папку."
              : inPrompts
                ? "Здесь будут заготовки промптов и шаблоны запросов, которые ты используешь часто. Пока пусто."
                : "Здесь будут навыки агента (как скиллы Hermes): процедуры, которые агент осваивает и переиспользует. Пока пусто."
          }
        />
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
            <GlassPressable radius={16} intensity={30} style={{ padding: 16, marginTop: 8 }}>
              <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
                В папке пока пусто. Скажи агенту, что создать — он запишет файлы сюда.
              </Text>
            </GlassPressable>
          )}
          {files.map((f, i) => {
            const isDir = !f.match(/\.[a-zA-Z0-9]+$/);
            const name = f.split("/").pop();
            return (
              <Pressable
                key={i}
                onPress={() => !isDir && openPreview(f)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10, padding: 11,
                  borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginTop: 6,
                  backgroundColor: "transparent",
                }}
              >
                <MaterialIcons name={isDir ? "folder" : "insert-drive-file"} size={17} color={isDir ? theme.warn : theme.accentHi} />
                <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 12.5, fontFamily: "monospace" }}>{name}</Text>
                {!isDir && <MaterialIcons name="visibility" size={14} color={theme.mute} />}
              </Pressable>
            );
          })}
        </>
      ) : (
        <>
          <Pressable onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <MaterialIcons name="arrow-back" size={15} color={theme.accentHi} />
            <Text style={{ color: theme.accentHi, fontSize: 12.5, fontFamily: fonts.mono }}>{previewPath}</Text>
          </Pressable>
          <View style={{ backgroundColor: theme.codeBg, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12 }}>
            <Text selectable style={{ color: theme.codeText, fontSize: 12, fontFamily: fonts.mono, lineHeight: 18 }}>
              {previewContent}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

/* ── Концепт-папка (Самообучение/Промпты/Скиллы) ── */
function ConceptFolder({ theme, label, hint }: { theme: any; label: string; hint: string }) {
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
        Папка «{label}»
      </Text>
      <GlassPressable radius={16} intensity={30} style={{ padding: 18, marginTop: 8 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)", marginBottom: 10 }}>
          <MaterialIcons name={label === "Самообучение" ? "auto-stories" : label === "Промпты" ? "text-snippet" : "extension"} size={20} color={theme.accentHi} />
        </View>
        <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 20 }}>{hint}</Text>
      </GlassPressable>
    </View>
  );
}