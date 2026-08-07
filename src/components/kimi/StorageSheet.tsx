/**
 * StorageSheet — «Хранилище» приложения (заменяет вкладку «Проект»).
 *
 * По аналогии с хранилищем Hermes: проекты + все сохранённые файлы +
 * инструкции для агента. Три вкладки:
 *   • Проекты      — создать / выбрать / переименовать / удалить проект.
 *   • Файлы        — список файлов выбранного проекта + просмотр содержимого.
 *   • Инструкции   — INSTRUCTIONS.md проекта (правила для агента),
 *                   редактируется здесь и подключается в контекст.
 *
 * Всё в стиле Kimi: стеклянные панели, капсулы, Geist Mono, без эмодзи.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
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
  createProject,
  deleteProject,
  renameProject,
  treeFiles,
  readFile,
  writeFile,
} from "../../core/vibeLocal";
import { showToast } from "../../design-system/components/Toast";

const INSTRUCTIONS_FILE = "INSTRUCTIONS.md";
type Tab = "projects" | "files" | "instructions";

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

  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [npName, setNpName] = useState("");
  const [npDesc, setNpDesc] = useState("");

  const [menuTarget, setMenuTarget] = useState<VibeProject | null>(null);
  const [rnValue, setRnValue] = useState("");

  const [files, setFiles] = useState<string[]>([]);
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
      setPreviewPath(null);
    }
  }, [visible, load]);

  useEffect(() => {
    if (tab === "files" && activeProj) {
      treeFiles(activeProj.id)
        .then((t) => setFiles(t.trim().split("\n").map((l) => l.trim()).filter(Boolean)))
        .catch(() => setFiles([]));
    }
  }, [tab, activeProj]);

  useEffect(() => {
    if (tab === "instructions" && activeProj) {
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
  }, [tab, activeProj]);

  const createNew = useCallback(async () => {
    const n = npName.trim();
    if (!n) return;
    try {
      const p = await createProject(n, npDesc);
      setNpName("");
      setNpDesc("");
      setCreateOpen(false);
      onSelectProject(p);
      await load();
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    }
  }, [npName, npDesc, onSelectProject, load]);

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

  const onRename = useCallback(async () => {
    const nm = rnValue.trim();
    if (!menuTarget) return;
    if (nm && nm !== menuTarget.name) {
      try {
        await renameProject(menuTarget.id, nm);
        showToast("ok", "Проект переименован");
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    }
    setMenuTarget(null);
    await load();
  }, [rnValue, menuTarget, load]);

  const onDelete = useCallback(async () => {
    const p = menuTarget;
    setMenuTarget(null);
    if (!p) return;
    try {
      await deleteProject(p.id);
      showToast("ok", "Проект удалён");
      await load();
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    }
  }, [menuTarget, load]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Хранилище" snapPoints={["80%"]}>
      {/* вкладки */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(
          [
            ["projects", "Проекты", "folder"],
            ["files", "Файлы", "insert-drive-file"],
            ["instructions", "Инструкции", "menu-book"],
          ] as [Tab, string, keyof typeof MaterialIcons.glyphMap][]
        ).map(([k, label, icon]) => {
          const on = tab === k;
          return (
            <GlassPressable
              key={k}
              radius={18}
              intensity={30}
              onPress={() => setTab(k)}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, paddingVertical: 8 }}
              accessibilityLabel={label}
            >
              <MaterialIcons name={icon} size={14} color={on ? theme.accentHi : theme.dim} />
              <Text style={{ color: on ? theme.accentHi : theme.dim, fontSize: 12.5, fontFamily: fonts.sansDemi }}>
                {label}
              </Text>
            </GlassPressable>
          );
        })}
      </View>

      {/* ── Проекты ── */}
      {tab === "projects" && (
        <View style={{ marginTop: 12 }}>
          {!createOpen ? (
            <Button title="＋ Новый проект" onPress={() => setCreateOpen(true)} fullWidth />
          ) : (
            <View>
              <Input value={npName} onChangeText={setNpName} placeholder="Название проекта" autoFocus style={{ marginTop: 2 }} />
              <View style={{ height: 8 }} />
              <Input value={npDesc} onChangeText={setNpDesc} placeholder="Описание" multiline style={{ minHeight: 56 }} />
              <View style={{ height: 8 }} />
              <Button title="Создать и открыть" onPress={createNew} disabled={!npName.trim()} fullWidth />
              <Button title="Отмена" variant="ghost" onPress={() => { setCreateOpen(false); setNpName(""); setNpDesc(""); }} fullWidth style={{ marginTop: 6 }} />
            </View>
          )}

          {/* без проекта */}
          <Pressable
            onPress={() => onSelectProject(null)}
            style={{
              flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
              borderRadius: 13, borderWidth: 1, marginTop: 10,
              borderColor: !activeProj ? theme.accent : theme.border,
              backgroundColor: !activeProj ? theme.accentDim : "transparent",
            }}
          >
            <MaterialIcons name="chat-bubble-outline" size={18} color={!activeProj ? theme.accentHi : theme.mute} />
            <Text style={{ flex: 1, color: !activeProj ? theme.accentHi : theme.text, fontSize: 13, fontWeight: "600" }}>Без проекта</Text>
            <Text style={{ color: theme.mute, fontSize: 10 }}>обычный чат</Text>
          </Pressable>

          <Text style={{ color: theme.mute, fontSize: 11, marginTop: 14, marginBottom: 4 }}>
            {loading ? "Загрузка…" : projects.length === 0 ? "Пока нет проектов — создай первый." : `${projects.length} проект(ов)`}
          </Text>

          {projects.map((p) => {
            const on = activeProjectId === p.id;
            return (
              <View key={p.id}>
                <Pressable
                  onPress={() => onSelectProject(p)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                    borderRadius: 13, borderWidth: 1, marginTop: 8,
                    borderColor: on ? theme.accent : theme.border,
                    backgroundColor: on ? theme.accentDim : "transparent",
                  }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: on ? theme.accentDim : theme.surface2, alignItems: "center", justifyContent: "center" }}>
                    <MaterialIcons name="folder" size={18} color={on ? theme.accentHi : theme.dim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, fontWeight: "500" }}>{p.name}</Text>
                    {p.desc ? <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{p.desc}</Text> : null}
                    <Text style={{ color: theme.mute, fontSize: 9.5, marginTop: 2, fontFamily: "monospace" }}>
                      {fileCounts[p.id] ?? 0} файлов
                    </Text>
                  </View>
                  {on && <MaterialIcons name="check-circle" size={16} color={theme.accentHi} />}
                  <Pressable
                    onPress={() => { setMenuTarget(p); setRnValue(p.name); }}
                    hitSlop={8} style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" }}
                    accessibilityLabel="Меню проекта"
                  >
                    <MaterialIcons name="more-vert" size={17} color={theme.dim} />
                  </Pressable>
                </Pressable>

                {menuTarget?.id === p.id && (
                  <View style={{ marginTop: 8 }}>
                    <Input value={rnValue} onChangeText={setRnValue} placeholder="Новое название" autoFocus style={{ marginTop: 2 }} />
                    <View style={{ height: 8 }} />
                    <Button title="Переименовать" variant="secondary" onPress={onRename} fullWidth />
                    <Button title="Удалить проект" variant="danger" onPress={onDelete} fullWidth style={{ marginTop: 6 }} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Файлы ── */}
      {tab === "files" && (
        <View style={{ marginTop: 12 }}>
          {!activeProj ? (
            <Text style={{ color: theme.dim, fontSize: 13 }}>Выбери проект, чтобы увидеть его файлы.</Text>
          ) : !previewPath ? (
            <>
              <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 4 }}>
                {activeProj.name} · {files.length} записей
              </Text>
              {files.length === 0 && <Text style={{ color: theme.dim, fontSize: 13, marginTop: 8 }}>Файлов пока нет.</Text>}
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
              <Pressable onPress={() => { setPreviewPath(null); setPreviewContent(""); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
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
      )}

      {/* ── Инструкции ── */}
      {tab === "instructions" && (
        <View style={{ marginTop: 12 }}>
          {!activeProj ? (
            <Text style={{ color: theme.dim, fontSize: 13 }}>Выбери проект, чтобы настроить его инструкции.</Text>
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
                  backgroundColor: theme.codeBg, borderColor: theme.border, borderWidth: 1,
                  borderRadius: 12, padding: 12, fontSize: 12.5, color: theme.codeText,
                  fontFamily: fonts.mono, lineHeight: 19, minHeight: 200,
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
    </Sheet>
  );
}