/**
 * Vibe Project — агент-чат (прямой канал) + локальные файлы.
 *
 * Всё на устройстве:
 *  - чат с агентом — через gateway.ts (напрямую к провайдеру);
 *  - файлы, которые агент «пишет» блоками [FILE:…], сохраняются
 *    в documentDirectory/vibe/<project>/ на самом телефоне.
 *  - история чата — локально (AsyncStorage).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useApp, genId } from "../store/AppStore";
import { renderMarkdown } from "../components/Markdown";
import { Sheet } from "../design-system/components/Sheet";
import { IconButton } from "../design-system/components/IconButton";
import { Button } from "../design-system/components/Button";
import { Input } from "../design-system/components/Input";
import { showToast } from "../design-system/components/Toast";
import { formatBytes } from "../design-system/tokens";
import {
  VibeMsg,
  VibeFileEntry,
  createDir,
  deleteDirRecursive,
  deleteFile,
  listDir,
  listFiles,
  loadMessages,
  projectStoragePath,
  readFile,
  renameDir,
  renameFile,
  saveMessages,
  vibeChat,
  writeFile,
} from "../core/vibeLocal";
import { openInTermux, openFolderInFileManager } from "../core/termux";

export function VibeProjectScreen({ route, navigation }: { route: any; navigation: any }) {
  const { state, theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const { id: projectId, name: projectName } = route.params;

  const [messages, setMessages] = useState<VibeMsg[]>([]);
  const [files, setFiles] = useState<VibeFileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [mode, setMode] = useState<"chat" | "files">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<VibeMsg>>(null);

  const allModels = [...state.models, ...state.customModels];
  const model =
    allModels.find((m) => m.modelName === state.sessions.find((s) => s.id === state.activeSessionId)?.modelId) ??
    allModels[0];

  // Путь хранения файлов проекта — показываем пользователю (B18)
  const storagePath = projectStoragePath(projectId);

  const loadMsgs = useCallback(async () => {
    const msgs = await loadMessages(projectId);
    if (msgs.length === 0) {
      msgs.push({
        id: genId(),
        role: "assistant",
        content: "Проект готов. Опиши задачу — агент напишет код, файлы сохранятся на устройстве.",
      });
    }
    setMessages(msgs);
  }, [projectId]);

  const loadFiles = useCallback(async () => {
    try {
      const fl = await listFiles(projectId);
      setFiles(fl);
    } catch {
      setFiles([]);
    }
  }, [projectId]);

  useEffect(() => {
    loadMsgs();
    loadFiles();
  }, [loadMsgs, loadFiles]);

  // Сохранение истории — debounce, НЕ внутри setMessages (убирает race и
  // лишние записи в AsyncStorage на каждый токен).
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      saveMessages(projectId, messages).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [messages, projectId]);

  const scrollBottom = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || busy || !model) return;
    setText("");
    setBusy(true);
    stopRef.current = false;

    const userMsg: VibeMsg = { id: genId(), role: "user", content };
    const aiId = genId();
    const aiMsg: VibeMsg = { id: aiId, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);
    scrollBottom();

    let acc = "";
    let written: string[] = [];

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    await vibeChat(model, projectId, [...messages, userMsg], {
      onToken: (tok) => {
        if (stopRef.current) return;
        acc += tok;
        setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: acc } : x)));
        scrollBottom();
      },
      onTool: (label) => {
        setMessages((m) => [...m, { id: genId(), role: "assistant", content: "", tool: label }]);
      },
      onDone: (cleanText, filesWritten) => {
        written = filesWritten;
        const finalText = cleanText?.trim() || acc?.trim() || (stopRef.current ? "" : "Агент не ответил. Попробуй переформулировать запрос.");
        setMessages((m) =>
          m.map((x) =>
            x.id === aiId ? { ...x, content: finalText, streaming: false } : x,
          ),
        );
        if (filesWritten.length > 0) loadFiles();
        setBusy(false);
      },
      onError: (err) => {
        if (stopRef.current) { setBusy(false); return; } // abort по Стоп — тихо
        setMessages((m) =>
          m.map((x) =>
            x.id === aiId ? { ...x, content: acc, streaming: false, result: err } : x,
          ),
        );
        setBusy(false);
      },
    }, ctrl.signal);
    if (stopRef.current) {
      setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, streaming: false } : x)));
      setBusy(false);
    }
  }, [text, busy, model, projectId, messages, loadFiles]);

  const stop = useCallback(() => {
    stopRef.current = true;
    setBusy(false);
    abortRef.current?.abort();
  }, []);

  const viewFile = useCallback(
      async (name: string) => {
        try {
          const content = await readFile(projectId, name);
                  setFileContent(content || "(пусто)");
                  setViewName(name);
                  setEditMode(false);
                  setShowFile(true);
        } catch (e: any) {
          showToast("err", String(e?.message || e));
        }
      },
      [projectId],
    );

    const [editMode, setEditMode] = useState(false);
    const [editName, setEditName] = useState("");
    const [editContent, setEditContent] = useState("");
    const [editOpen, setEditOpen] = useState(false);

    const startEdit = useCallback(async (name: string) => {
      try {
        const content = await readFile(projectId, name);
        setEditName(name);
        setEditContent(content);
        setEditOpen(true);
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    }, [projectId]);

    const saveEdit = useCallback(async () => {
      try {
        await writeFile(projectId, editName, editContent);
        showToast("ok", "Файл сохранён");
        setEditOpen(false);
        loadFiles();
        refreshDir();
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    }, [projectId, editName, editContent, loadFiles]);

    // ── файловый менеджер: навигация по папкам + операции ──
    const [currentDir, setCurrentDir] = useState("");
    const [dirEntries, setDirEntries] = useState<{ name: string; isDir: boolean; size: number }[]>([]);
    const [newFileOpen, setNewFileOpen] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [newDirOpen, setNewDirOpen] = useState(false);
    const [newDirName, setNewDirName] = useState("");
    const [renameTarget, setRenameTarget] = useState<{ name: string; isDir: boolean } | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<{ name: string; isDir: boolean } | null>(null);
    const [fileMenu, setFileMenu] = useState<{ name: string; isDir: boolean } | null>(null);

    const refreshDir = useCallback(async () => {
      try {
        const entries = await listDir(projectId, currentDir);
        setDirEntries(entries);
      } catch {
        setDirEntries([]);
      }
    }, [projectId, currentDir]);

    useEffect(() => {
      refreshDir();
    }, [refreshDir]);

    const openDir = useCallback((name: string) => {
      const clean = name.replace(/\/$/, "");
      setCurrentDir((prev) => (prev ? `${prev}/${clean}` : clean));
    }, []);

    const goUp = useCallback(() => {
      setCurrentDir((prev) => {
        const idx = prev.lastIndexOf("/");
        return idx > 0 ? prev.slice(0, idx) : "";
      });
    }, []);

    const fullRel = useCallback((name: string) => {
      const clean = name.replace(/\/$/, "");
      return currentDir ? `${currentDir}/${clean}` : clean;
    }, [currentDir]);

    const confirmRename = useCallback(async () => {
      if (!renameTarget) return;
      const newName = renameValue.trim();
      if (!newName) return;
      try {
        if (renameTarget.isDir) await renameDir(projectId, fullRel(renameTarget.name), newName);
        else await renameFile(projectId, fullRel(renameTarget.name), newName);
        showToast("ok", "Переименовано");
        setRenameTarget(null);
        refreshDir();
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    }, [renameTarget, renameValue, projectId, fullRel, refreshDir]);

    const confirmDelete = useCallback(async () => {
      if (!deleteTarget) return;
      try {
        if (deleteTarget.isDir) await deleteDirRecursive(projectId, fullRel(deleteTarget.name));
        else await deleteFile(projectId, fullRel(deleteTarget.name));
        showToast("ok", "Удалено");
        setDeleteTarget(null);
        refreshDir();
        loadFiles();
      } catch (e: any) {
        showToast("err", String(e?.message || e));
      }
    }, [deleteTarget, projectId, fullRel, refreshDir, loadFiles]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8, paddingTop: insets.top + 4, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <IconButton name="arrow-back" onPress={() => navigation.goBack()} accessibilityLabel={t("back")} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{projectName}</Text>
          <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 9.5, fontFamily: "monospace" }}>
            {model ? model.displayName : "…"} · {storagePath}
          </Text>
        </View>
        <IconButton
          name="folder-open"
          size={17}
          onPress={async () => {
            const r = await openFolderInFileManager(projectId);
            if (!r.ok) showToast("err", r.message);
          }}
          accessibilityLabel="Открыть папку в файловом менеджере"
        />
        <IconButton
          name="terminal"
          size={17}
          onPress={async () => {
            const r = await openInTermux(projectId);
            if (!r.ok) showToast("err", r.message);
            else showToast("ok", "Termux запущен");
          }}
          accessibilityLabel="Открыть проект в Termux"
        />
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}>
        {([
          ["chat", "chat-bubble-outline", "chat-bubble"],
          ["files", "folder-outline", "folder"],
        ] as const).map(([m, icon, activeIcon]) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingVertical: 7,
              paddingHorizontal: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: mode === m ? theme.accent : theme.border,
              backgroundColor: mode === m ? theme.accentDim : theme.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <MaterialIcons
              name={mode === m ? (activeIcon as any) : (icon as any)}
              size={14}
              color={mode === m ? theme.accentHi : theme.dim}
            />
            <Text style={{ color: mode === m ? theme.accentHi : theme.dim, fontSize: 11, fontWeight: "600" }}>
              {m === "chat" ? "Чат" : m === "files" ? "Файлы" : "Терминал"}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "chat" && (
        <>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 14 }}
            onContentSizeChange={scrollBottom}
            renderItem={({ item }) => <VibeBubble msg={item} theme={theme} />}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : insets.top}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Инструкция агенту…"
                placeholderTextColor={theme.mute}
                multiline
                textAlignVertical="top"
                style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 14, color: theme.text, maxHeight: 100, minHeight: 44 }}
              />
              {busy ? (
                <Pressable onPress={stop} style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="stop" size={20} color="#fff" />
                </Pressable>
              ) : (
                <Pressable onPress={send} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: text.trim() ? theme.accent : theme.surface2, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="send" size={20} color={text.trim() ? theme.onAccent : theme.mute} />
                </Pressable>
              )}
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      {mode === "files" && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              {currentDir !== "" && (
                <Pressable onPress={goUp} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2, padding: 4, borderRadius: 7, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
                  <MaterialIcons name="arrow-upward" size={14} color={theme.accentHi} />
                  <Text style={{ color: theme.accentHi, fontSize: 11, fontWeight: "600" }}>Наверх</Text>
                </Pressable>
              )}
              <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 11, fontFamily: "monospace", flex: 1 }}>
                {currentDir ? `/${currentDir}/` : "/ · корень проекта"}
              </Text>
            </View>
            <Pressable onPress={() => setNewDirOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3, padding: 5 }}>
              <MaterialIcons name="create-new-folder" size={16} color={theme.accentHi} />
              <Text style={{ color: theme.accentHi, fontSize: 11, fontWeight: "600" }}>папка</Text>
            </Pressable>
            <Pressable onPress={() => setNewFileOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3, padding: 5 }}>
              <MaterialIcons name="add" size={16} color={theme.accentHi} />
              <Text style={{ color: theme.accentHi, fontSize: 11, fontWeight: "600" }}>файл</Text>
            </Pressable>
          </View>
          <FlatList
            data={dirEntries}
            keyExtractor={(e) => e.name}
            contentContainerStyle={{ padding: 14, paddingTop: 6 }}
            ListEmptyComponent={
              <Text style={{ color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 30 }}>
                {currentDir ? "Папка пуста." : "Пока пусто. Опиши задачу в чате — агент создаст файлы."}
              </Text>
            }
            renderItem={({ item }) => {
              const rel = fullRel(item.name);
              return (
                <Pressable
                  onPress={() => (item.isDir ? openDir(item.name) : viewFile(rel))}
                  onLongPress={() => setFileMenu({ name: item.name, isDir: item.isDir })}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6, opacity: pressed ? 0.85 : 1 })}
                >
                  <MaterialIcons name={item.isDir ? "folder" : "insert-drive-file"} size={16} color={item.isDir ? "#fbbf24" : theme.accentHi} />
                  <Text style={{ flex: 1, color: theme.text, fontSize: 12, fontFamily: "monospace" }}>{item.name}</Text>
                  <Text style={{ color: theme.mute, fontSize: 9.5, fontFamily: "monospace" }}>{item.isDir ? "" : formatBytes(item.size)}</Text>
                </Pressable>
              );
            }}
          />
        </>
      )}

      {/* file viewer modal */}
      <Sheet visible={showFile} onClose={() => setShowFile(false)} title="Файл" snapPoints={["75%"]}>
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 10, gap: 8 }}>
          <Button title="Копировать" variant="secondary" onPress={() => fileContent && Clipboard.setStringAsync(fileContent).then(() => showToast("ok", "Скопировано"))} style={{ flex: 1 }} />
          <Button title="Редактировать" variant="secondary" onPress={() => { setShowFile(false); if (viewName) startEdit(viewName); }} style={{ flex: 1 }} />
        </View>
        <ScrollView style={{ maxHeight: "74%", backgroundColor: theme.codeBg, borderRadius: 10, padding: 12 }}>
          <Text selectable style={{ color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>
            {fileContent ?? "(пусто)"}
          </Text>
        </ScrollView>
      </Sheet>

      {/* edit file sheet */}
      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title={`Правка: ${editName}`} snapPoints={["90%"]}>
        <TextInput
          value={editContent}
          onChangeText={setEditContent}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={{ backgroundColor: theme.codeBg, color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 18, borderRadius: 10, padding: 12, minHeight: 320, textAlignVertical: "top" }}
        />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Button title="Отмена" variant="secondary" onPress={() => setEditOpen(false)} style={{ flex: 1 }} />
          <Button title="Сохранить" onPress={saveEdit} style={{ flex: 1 }} />
        </View>
      </Sheet>

      {/* new file sheet */}
      <Sheet visible={newFileOpen} onClose={() => setNewFileOpen(false)} title="Новый файл" snapPoints={["40%"]}>
        <Input
          value={newFileName}
          onChangeText={setNewFileName}
          placeholder={currentDir ? `${currentDir}/имя.файла` : "src/index.ts"}
          placeholderTextColor={theme.mute}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={async () => {
            const name = newFileName.trim();
            if (!name) return;
            const rel = fullRel(name);
            try { await writeFile(projectId, rel, ""); showToast("ok", "Файл создан"); setNewFileOpen(false); setNewFileName(""); refreshDir(); loadFiles(); }
            catch (e: any) { showToast("err", String(e?.message || e)); }
          }}
          style={{ backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, fontSize: 13, color: theme.text, fontFamily: "monospace", minHeight: 44 }}
        />
        <View style={{ height: 10 }} />
        <Button title="Создать" onPress={async () => {
          const name = newFileName.trim();
          if (!name) return;
          const rel = fullRel(name);
          try { await writeFile(projectId, rel, ""); showToast("ok", "Файл создан"); setNewFileOpen(false); setNewFileName(""); refreshDir(); loadFiles(); }
          catch (e: any) { showToast("err", String(e?.message || e)); }
        }} />
      </Sheet>

      {/* new dir sheet */}
      <Sheet visible={newDirOpen} onClose={() => setNewDirOpen(false)} title="Новая папка" snapPoints={["36%"]}>
        <Input
          value={newDirName}
          onChangeText={setNewDirName}
          placeholder="имя-папки"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={async () => {
            const name = newDirName.trim();
            if (!name) return;
            const rel = fullRel(name);
            try { await createDir(projectId, rel); showToast("ok", "Папка создана"); setNewDirOpen(false); setNewDirName(""); refreshDir(); }
            catch (e: any) { showToast("err", String(e?.message || e)); }
          }}
          style={{ marginTop: 4 }}
        />
        <View style={{ height: 10 }} />
        <Button title="Создать" onPress={async () => {
          const name = newDirName.trim();
          if (!name) return;
          const rel = fullRel(name);
          try { await createDir(projectId, rel); showToast("ok", "Папка создана"); setNewDirOpen(false); setNewDirName(""); refreshDir(); }
          catch (e: any) { showToast("err", String(e?.message || e)); }
        }} />
      </Sheet>

      {/* file menu (long-press): открыть/редактировать/переименовать/удалить */}
      <Sheet visible={!!fileMenu} onClose={() => setFileMenu(null)} title={fileMenu?.name ?? ""} snapPoints={["48%"]}>
        {fileMenu && (
          <>
            {!fileMenu.isDir && (
              <Button title="Открыть" variant="secondary" onPress={() => { const f = fileMenu; const rel = fullRel(f.name); setFileMenu(null); viewFile(rel); }} fullWidth style={{ marginTop: 6 }} />
            )}
            {!fileMenu.isDir && (
              <Button title="Редактировать" variant="secondary" onPress={() => { const f = fileMenu; const rel = fullRel(f.name); setFileMenu(null); startEdit(rel); }} fullWidth style={{ marginTop: 6 }} />
            )}
            <Button title="Переименовать" variant="secondary" onPress={() => { setRenameValue(fileMenu.name.replace(/\/$/, "")); setRenameTarget(fileMenu); setFileMenu(null); }} fullWidth style={{ marginTop: 6 }} />
            <Button title="Удалить" variant="danger" onPress={() => { setDeleteTarget(fileMenu); setFileMenu(null); }} fullWidth style={{ marginTop: 6 }} />
          </>
        )}
      </Sheet>

      {/* rename entry */}
      <Sheet visible={!!renameTarget} onClose={() => setRenameTarget(null)} title="Переименовать" snapPoints={["36%"]}>
        {renameTarget && (
          <>
            <Input
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={confirmRename}
              style={{ marginTop: 4 }}
            />
            <View style={{ height: 10 }} />
            <Button title="Сохранить" onPress={confirmRename} />
          </>
        )}
      </Sheet>

      {/* delete entry confirm */}
      <Sheet visible={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Удалить?" snapPoints={["34%"]}>
        {deleteTarget && (
          <>
            <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
              {deleteTarget.isDir ? "Папка" : "Файл"} «{deleteTarget.name}» будет удалён безвозвратно.
            </Text>
            <View style={{ height: 10 }} />
            <Button title="Удалить" variant="danger" onPress={confirmDelete} fullWidth />
          </>
        )}
      </Sheet>
    </View>
  );
}

function VibeBubble({ msg, theme }: { msg: VibeMsg; theme: any }) {
  if (msg.streaming) {
    return (
      <View style={{ alignSelf: "flex-start", marginBottom: 8, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accentHi }} />
          ))}
        </View>
        <Text style={{ color: theme.dim, fontSize: 11, marginTop: 5 }}>агент работает…</Text>
      </View>
    );
  }
  if (msg.tool) {
    return (
      <View style={{ alignSelf: "flex-start", marginBottom: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: "rgba(251,191,36,.35)", backgroundColor: "rgba(251,191,36,.06)" }}>
        <Text style={{ color: "#fbbf24", fontSize: 10, fontFamily: "monospace" }}>⚙ {msg.tool}</Text>
      </View>
    );
  }
  if (msg.result && !msg.content) {
    return (
      <View style={{ alignSelf: "flex-start", marginBottom: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.danger, fontSize: 10, fontFamily: "monospace" }}>{msg.result}</Text>
      </View>
    );
  }
  const user = msg.role === "user";
  return (
    <View style={{ alignSelf: user ? "flex-end" : "flex-start", maxWidth: "88%", marginBottom: 10 }}>
      <View style={{ backgroundColor: user ? theme.userBubble : theme.surface, borderRadius: 14, borderTopLeftRadius: user ? 14 : 4, borderTopRightRadius: user ? 14 : 14, borderWidth: user ? 0 : 1, borderColor: user ? undefined : theme.border, paddingHorizontal: 13, paddingVertical: 9 }}>
        {user ? (
          <Text style={{ color: theme.userText, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
        ) : (
          renderMarkdown(msg.content, theme)
        )}
      </View>
      {msg.result ? (
        <Text style={{ color: theme.dim, fontSize: 10, fontFamily: "monospace", marginTop: 3 }}>{msg.result}</Text>
      ) : null}
    </View>
  );
}
