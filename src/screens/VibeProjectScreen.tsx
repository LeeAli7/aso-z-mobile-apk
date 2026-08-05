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
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp, genId } from "../store/AppStore";
import { renderMarkdown } from "../components/Markdown";
import { BottomSheet } from "../components/ui";
import {
  VibeMsg,
  VibeFileEntry,
  listFiles,
  loadMessages,
  readFile,
  saveMessages,
  vibeChat,
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
  const listRef = useRef<FlatList<VibeMsg>>(null);

  const model =
    state.models.find((m) => m.modelName === state.sessions.find((s) => s.id === state.activeSessionId)?.modelId) ??
    state.models[0];

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
    setMessages((m) => {
      const next = [...m, userMsg, aiMsg];
      saveMessages(projectId, next);
      return next;
    });
    scrollBottom();

    let acc = "";
    let written: string[] = [];

    await vibeChat(model, projectId, [...messages, userMsg], {
      onToken: (tok) => {
        if (stopRef.current) return;
        acc += tok;
        setMessages((m) => {
          const next = m.map((x) => (x.id === aiId ? { ...x, content: acc } : x));
          saveMessages(projectId, next);
          return next;
        });
        scrollBottom();
      },
      onTool: (label) => {
        setMessages((m) => [...m, { id: genId(), role: "assistant", content: "", tool: label }]);
      },
      onDone: (cleanText, filesWritten) => {
        written = filesWritten;
        setMessages((m) => {
          const next = m.map((x) =>
            x.id === aiId ? { ...x, content: cleanText || acc, streaming: false } : x,
          );
          saveMessages(projectId, next);
          return next;
        });
        if (filesWritten.length > 0) loadFiles();
        setBusy(false);
      },
      onError: (err) => {
        setMessages((m) => {
          const next = m.map((x) =>
            x.id === aiId ? { ...x, content: acc, streaming: false, result: err } : x,
          );
          saveMessages(projectId, next);
          return next;
        });
        setBusy(false);
      },
    });
    if (stopRef.current) {
      setMessages((m) => {
        const next = m.map((x) => (x.id === aiId ? { ...x, streaming: false } : x));
        saveMessages(projectId, next);
        return next;
      });
      setBusy(false);
    }
  }, [text, busy, model, projectId, messages, loadFiles]);

  const stop = useCallback(() => {
    stopRef.current = true;
    setBusy(false);
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 8, paddingTop: insets.top + 6, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 9, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.dim, fontSize: 14 }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{projectName}</Text>
          <Text style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>
            {model ? model.displayName : "…"} · на устройстве
          </Text>
        </View>
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}>
        {(["chat", "files"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: mode === m ? theme.accent : theme.border, backgroundColor: mode === m ? theme.accent : theme.surface }}
          >
            <Text style={{ color: mode === m ? (theme.name === "dark" ? "#1c1202" : "#fdf9f2") : theme.dim, fontSize: 10, fontWeight: "600" }}>
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
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Инструкция агенту…"
              placeholderTextColor={theme.mute}
              multiline
              style={{ flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, fontSize: 14, color: theme.text, maxHeight: 90, minHeight: 40 }}
            />
            {busy ? (
              <Pressable onPress={stop} style={{ height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{t("stop")}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={send} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.name === "dark" ? "#1c1202" : "#fdf9f2", fontSize: 16 }}>➤</Text>
              </Pressable>
            )}
          </View>
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
              style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}
            >
              <Text style={{ color: theme.accentHi, fontFamily: "monospace", fontSize: 11 }}>▸</Text>
              <Text style={{ flex: 1, color: theme.text, fontSize: 12, fontFamily: "monospace" }}>{item.name}</Text>
              <Text style={{ color: theme.mute, fontSize: 9, fontFamily: "monospace" }}>{item.size} B</Text>
            </Pressable>
          )}
        />
      )}

      {/* file viewer modal */}
      <BottomSheet visible={showFile} onClose={() => setShowFile(false)} title="Файл">
        <ScrollView style={{ maxHeight: "70%", backgroundColor: theme.codeBg, borderRadius: 10, padding: 12 }}>
          <Text selectable style={{ color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>
            {fileContent}
          </Text>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function VibeBubble({ msg, theme }: { msg: VibeMsg; theme: any }) {
  if (msg.streaming) {
    return (
      <View style={{ alignSelf: "flex-start", marginBottom: 8, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderStyle: "dashed" }}>
        <Text style={{ color: theme.dim, fontSize: 12 }}>▊ агент работает…</Text>
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
