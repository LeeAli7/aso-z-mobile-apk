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
  Alert,
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
import { Paths } from "expo-file-system";
import { useApp, genId } from "../store/AppStore";
import { renderMarkdown } from "../components/Markdown";
import { Sheet } from "../design-system/components/Sheet";
import { IconButton } from "../design-system/components/IconButton";
import { Button } from "../design-system/components/Button";
import { showToast } from "../design-system/components/Toast";
import { formatBytes } from "../design-system/tokens";
import {
  VibeMsg,
  VibeFileEntry,
  deleteFile,
  listFiles,
  loadMessages,
  readFile,
  saveMessages,
  vibeChat,
  writeFile,
} from "../core/vibeLocal";

export function VibeProjectScreen({ route, navigation }: { route: any; navigation: any }) {
  const { state, theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const { id: projectId, name: projectName } = route.params;

  const [messages, setMessages] = useState<VibeMsg[]>([]);
  const [files, setFiles] = useState<VibeFileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
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
  const storagePath = `${Paths.document}/vibe/${projectId}/`;

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
    const fl = await listFiles(projectId);
    setFiles(fl);
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
        setMessages((m) =>
          m.map((x) =>
            x.id === aiId ? { ...x, content: cleanText || acc, streaming: false } : x,
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
        setShowFile(true);
      } catch (e: any) {
        Alert.alert("Error", String(e?.message || e));
      }
    },
    [projectId],
  );

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
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}>
        {([["chat", "chat-bubble-outline"], ["files", "folder", "list"]] as const).map(([m, icon, activeIcon]) => (
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
              {m === "chat" ? "Чат" : "Файлы"}
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
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Инструкция агенту…"
                placeholderTextColor={theme.mute}
                multiline
                style={{ flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, fontSize: 14, color: theme.text, maxHeight: 90, minHeight: 44 }}
              />
              {busy ? (
                <Pressable onPress={stop} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="stop" size={20} color="#fff" />
                </Pressable>
              ) : (
                <Pressable onPress={send} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: text.trim() ? theme.accent : theme.surface2, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="send" size={20} color={text.trim() ? theme.onAccent : theme.mute} />
                </Pressable>
              )}
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      {mode === "files" && (
        <FlatList
          data={files}
          keyExtractor={(f) => f.name}
          contentContainerStyle={{ padding: 14 }}
          ListHeaderComponent={
            <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 8, fontFamily: "monospace" }}>
              {files.length} файлов · хранятся на устройстве
            </Text>
          }
          ListEmptyComponent={
            <Text style={{ color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 30 }}>
              Пока пусто. Опиши задачу в чате — агент создаст файлы.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => viewFile(item.name)}
              onLongPress={() => Alert.alert("Файл", item.name, [
                { text: t("cancel"), style: "cancel" },
                { text: "Удалить", style: "destructive", onPress: async () => {
                  try { await deleteFile(projectId, item.name); showToast("ok", "Файл удалён"); loadFiles(); }
                  catch (e: any) { showToast("err", String(e?.message || e)); }
                } },
              ])}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6, opacity: pressed ? 0.85 : 1 })}
            >
              <MaterialIcons name="insert-drive-file" size={16} color={theme.accentHi} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 12, fontFamily: "monospace" }}>{item.name}</Text>
              <Text style={{ color: theme.mute, fontSize: 9.5, fontFamily: "monospace" }}>{formatBytes(item.size)}</Text>
            </Pressable>
          )}
        />
      )}

      {/* file viewer modal */}
      <Sheet visible={showFile} onClose={() => setShowFile(false)} title="Файл" snapPoints={["70%"]}>
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 10 }}>
          <Button title="Копировать" variant="secondary" onPress={() => fileContent && Clipboard.setStringAsync(fileContent).then(() => showToast("ok", "Скопировано"))} />
          <Button title="Закрыть" variant="secondary" onPress={() => setShowFile(false)} />
        </View>
        <ScrollView style={{ maxHeight: "72%", backgroundColor: theme.codeBg, borderRadius: 10, padding: 12 }}>
          <Text selectable style={{ color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>
            {fileContent ?? "(пусто)"}
          </Text>
        </ScrollView>
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
