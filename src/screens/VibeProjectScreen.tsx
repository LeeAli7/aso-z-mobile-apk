/**
 * Vibe Project — агент-чат (SSE + tool events), файлы, терминал.
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
import { apiFetch } from "../core/apiClient";
import { config } from "../core/env";
import { renderMarkdown } from "../components/Markdown";
import { BottomSheet } from "../components/ui";

interface VibeMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool?: string;
  result?: string;
  streaming?: boolean;
}

export function VibeProjectScreen({ route, navigation }: { route: any; navigation: any }) {
  const { state, theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const { id: projectId, name: projectName } = route.params;

  const [messages, setMessages] = useState<VibeMsg[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [terminalOut, setTerminalOut] = useState<string>("");
  const [termInput, setTermInput] = useState("");
  const [mode, setMode] = useState<"chat" | "files" | "term">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<any>>(null);

  const loadDetail = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/mobile/vibe/projects/${projectId}`, state.token);
      const msgs = (data.messages ?? []).map((m: any) => ({ id: genId(), role: m.role, content: m.content }));
      if (msgs.length === 0) {
        msgs.push({ id: genId(), role: "assistant", content: "Проект готов. Опиши задачу — агент напишет код." });
      }
      setMessages(msgs);
    } catch {}
  }, [projectId, state.token]);

  const loadFiles = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/mobile/vibe/projects/${projectId}/files`, state.token);
      setFiles(data.files ?? []);
    } catch {}
  }, [projectId, state.token]);

  useEffect(() => { loadDetail(); loadFiles(); }, [loadDetail, loadFiles]);

  const scrollBottom = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || busy) return;
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { id: genId(), role: "user", content }]);
    const aiId = genId();
    setMessages((m) => [...m, { id: aiId, role: "assistant", content: "", streaming: true }]);
    scrollBottom();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(
        `${config.apiBase}/api/mobile/vibe/projects/${projectId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ message: content }),
          signal: ctrl.signal,
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          let line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data:")) line = line.slice(5).trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.token) {
              acc += evt.token;
              setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: acc } : x)));
              scrollBottom();
            } else if (evt.tool_start) {
              setMessages((m) => [...m, { id: genId(), role: "assistant", content: "", tool: evt.tool_start }]);
            } else if (evt.tool_result) {
              setMessages((m) => {
                const copy = [...m];
                for (let i = copy.length - 1; i >= 0; i--) {
                  if (copy[i]?.tool) {
                    copy[i] = { ...copy[i], tool: undefined, result: String(evt.result || "").slice(0, 200) };
                    break;
                  }
                }
                return copy;
              });
            } else if (evt.done) {
              setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: evt.clean_text || acc, streaming: false } : x)));
              loadFiles();
            } else if (evt.error) {
              setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: "", streaming: false, result: evt.error } : x)));
            }
          } catch {}
        }
      }
      setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, streaming: false } : x)));
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, streaming: false, result: String(e?.message || e) } : x)));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [text, busy, projectId, state.token, loadFiles]);

  const runTerminal = useCallback(async () => {
    const cmd = termInput.trim();
    if (!cmd) return;
    setTerminalOut((o) => o + "$ " + cmd + "\n");
    setTermInput("");
    try {
      const data = await apiFetch(`/api/mobile/vibe/projects/${projectId}/terminal`, state.token, {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
      setTerminalOut((o) => o + (data.output || "") + (data.code === 0 ? "" : `\n[exit ${data.code}]`) + "\n");
    } catch (e: any) {
      setTerminalOut((o) => o + `[error: ${e?.message || e}]\n`);
    }
  }, [termInput, projectId, state.token]);

  const viewFile = useCallback(async (path: string) => {
    try {
      const data = await apiFetch(
        `/api/mobile/vibe/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
        state.token,
      );
      setFileContent(data.content || "(empty)");
      setShowFile(true);
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e));
    }
  }, [projectId, state.token]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 8, paddingTop: insets.top + 6, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 9, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.dim, fontSize: 14 }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{projectName}</Text>
          <Text style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>workspace</Text>
        </View>
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}>
        {(["chat", "files", "term"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: mode === m ? theme.accent : theme.border, backgroundColor: mode === m ? theme.accent : theme.surface }}
          >
            <Text style={{ color: mode === m ? (theme.name === "dark" ? "#1c1202" : "#fdf9f2") : theme.dim, fontSize: 10, fontWeight: "600" }}>
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
              {files.length} файлов
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

      {mode === "term" && (
        <View style={{ flex: 1, padding: 14 }}>
          <ScrollView style={{ flex: 1, backgroundColor: theme.codeBg, borderRadius: 10, padding: 10 }} contentContainerStyle={{ paddingBottom: 10 }}>
            <Text selectable style={{ color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>{terminalOut || "Терминал готов. Введи команду."}</Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <TextInput
              value={termInput}
              onChangeText={setTermInput}
              onSubmitEditing={runTerminal}
              placeholder="команда"
              placeholderTextColor={theme.mute}
              style={{ flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: theme.text, fontFamily: "monospace" }}
            />
            <Pressable onPress={runTerminal} style={{ height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: theme.name === "dark" ? "#1c1202" : "#fdf9f2", fontSize: 13, fontWeight: "600" }}>›</Text>
            </Pressable>
          </View>
        </View>
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