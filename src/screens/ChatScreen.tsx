/**
 * Чат — основной экран. Прямой канал к провайдеру (core/gateway).
 * Сессии выезжают снизу (bottom sheet), модели — тоже sheet.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { useApp, genId, Msg, Session } from "../store/AppStore";
import { ModelInfo, streamChat } from "../core/gateway";
import { BottomSheet, CapBadge } from "../components/ui";
import { renderMarkdown } from "../components/Markdown";

export function ChatScreen() {
  const { state, theme, dispatch, t, newSession, setActive, deleteSession } = useApp();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const stopRef = useRef(false);
  const listRef = useRef<FlatList<Msg>>(null);

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const model = state.models.find((m) => m.modelName === active?.modelId) ?? state.models[0];
  const modelName = model?.displayName ?? "Aso";

  const scrollBottom = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || streaming || !model) return;

    // ensure session
    let sid = active?.id;
    if (!sid) {
      sid = genId();
      dispatch({ type: "ADD_SESSION", session: {
        id: sid, name: content.slice(0, 40) || "New chat",
        messages: [], modelId: null, createdAt: Date.now(), updatedAt: Date.now(),
      }});
      setActive(sid);
    }

    dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: genId(), role: "user", content } });
    setText("");
    setStreaming(true);
    stopRef.current = false;
    scrollBottom();

    const cur = state.sessions.find((s) => s.id === sid);
    const history = (cur?.messages ?? [])
      .filter((m) => !m.streaming && !m.error)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    const aiId = genId();
    dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: aiId, role: "assistant", content: "", streaming: true } });

    let acc = "";
    await streamChat(model, history as never, {
      onToken: (tok) => {
        if (stopRef.current) return;
        acc += tok;
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
        scrollBottom();
      },
      onDone: (clean) => {
        setStreaming(false);
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { content: clean || acc || "(пусто)", streaming: false },
        });
      },
      onError: (err) => {
        setStreaming(false);
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { streaming: false, error: err, content: acc || "" },
        });
      },
    });
  }, [text, streaming, active, dispatch, model, setActive, scrollBottom]);

  const handleNewSession = useCallback(() => {
    const id = newSession();
    setActive(id);
    setSessionsOpen(false);
    setText("");
  }, [newSession, setActive]);

  const deleteSessionById = useCallback(
    (sid: string) => {
      Alert.alert(t("delete"), undefined, [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"), style: "destructive",
          onPress: () => { deleteSession(sid); setSessionsOpen(false); },
        },
      ]);
    },
    [deleteSession, t],
  );

  const renameSessionById = useCallback(
    (sid: string) => {
      const cur = state.sessions.find((s) => s.id === sid);
      if (!cur) return;
      Alert.prompt(t("rename"), undefined, (name) => {
        if (name && name.trim()) {
          dispatch({ type: "UPDATE_SESSION", sessionId: sid, patch: { name: name.trim() } });
        }
      }, "plain-text", cur.name);
    },
    [state.sessions, dispatch, t],
  );

  const switchModel = useCallback(
    (m: ModelInfo) => {
      if (active) {
        dispatch({ type: "UPDATE_SESSION", sessionId: active.id, patch: { modelId: m.modelName } });
      } else {
        const sid = genId();
        dispatch({ type: "ADD_SESSION", session: {
          id: sid, name: t("chat_title"), messages: [], modelId: m.modelName,
          createdAt: Date.now(), updatedAt: Date.now(),
        }});
        setActive(sid);
      }
      setModelsOpen(false);
    },
    [active, dispatch, setActive, t],
  );

  const copyMsg = (m: Msg) => Clipboard.setStringAsync(m.content).catch(() => {});
  const shareMsg = (m: Msg) => Share.share({ message: m.content }).catch(() => {});

  const sessionList = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 10, paddingTop: insets.top + 6, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bg }}>
        <Pressable onPress={() => setSessionsOpen(true)} hitSlop={8} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.dim, fontSize: 16 }}>≡</Text>
        </Pressable>
        <Pressable onPress={() => setModelsOpen(true)} style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>
            <Text style={{ color: theme.accentHi }}>● </Text>{modelName}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{active?.name ?? t("chat_title")}</Text>
        </Pressable>
        <Pressable onPress={handleNewSession} hitSlop={8} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.dim, fontSize: 16 }}>＋</Text>
        </Pressable>
      </View>

      {/* messages */}
      {(!active || active.messages.length === 0) ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Text style={{ color: "#1c1202", fontSize: 18, fontWeight: "700" }}>A</Text>
          </View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>{t("empty_chat_title")}</Text>
          <Text style={{ color: theme.dim, fontSize: 13, textAlign: "center", lineHeight: 19 }}>{t("empty_chat_sub")}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={active.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          onContentSizeChange={scrollBottom}
          renderItem={({ item }) => (
            <Bubble msg={item} theme={theme} onCopy={() => copyMsg(item)} onShare={() => shareMsg(item)} />
          )}
        />
      )}

      {streaming && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
          <Text style={{ color: theme.dim, fontSize: 12 }}>{t("streaming")}</Text>
        </View>
      )}

      {/* input */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingTop: 6, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("message_placeholder")}
          placeholderTextColor={theme.mute}
          multiline
          style={{ flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, fontSize: 14, color: theme.text, maxHeight: 90, minHeight: 40 }}
        />
        {streaming ? (
          <Pressable onPress={() => { stopRef.current = true; setStreaming(false); }} style={{ height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{t("stop")}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={send} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.name === "dark" ? "#1c1202" : "#fdf9f2", fontSize: 18 }}>→</Text>
          </Pressable>
        )}
      </View>

      {/* ── Sessions sheet ── */}
      <BottomSheet visible={sessionsOpen} onClose={() => setSessionsOpen(false)} title={t("sessions")}>
        <PrimaryBtn title={"＋ " + t("newSession")} onPress={handleNewSession} theme={theme} />
        {sessionList.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => { setActive(s.id); setSessionsOpen(false); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: s.id === active?.id ? theme.accent : theme.border, backgroundColor: s.id === active?.id ? theme.accentDim : theme.surface, marginTop: 8 }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13 }}>{s.name}</Text>
              <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2 }}>
                {s.messages.length} · {new Date(s.updatedAt).toLocaleDateString()}
              </Text>
            </View>
            <Pressable onPress={() => renameSessionById(s.id)} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: theme.dim, fontSize: 13 }}>{t("rename")}</Text>
            </Pressable>
            <Pressable onPress={() => deleteSessionById(s.id)} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: theme.danger, fontSize: 13 }}>{t("delete")}</Text>
            </Pressable>
          </Pressable>
        ))}
      </BottomSheet>

      {/* ── Models sheet ── */}
      <BottomSheet visible={modelsOpen} onClose={() => setModelsOpen(false)} title={t("model_select")}>
        {state.models.map((m) => {
          const on = model?.modelName === m.modelName;
          return (
            <Pressable
              key={m.modelName}
              onPress={() => switchModel(m)}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accentDim : theme.surface, marginTop: 8 }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? theme.accent : theme.border, alignItems: "center", justifyContent: "center" }}>
                {on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{m.displayName}</Text>
                <Text style={{ color: theme.mute, fontSize: 10, marginTop: 1, fontFamily: "monospace" }}>{m.tier.toUpperCase()}</Text>
              </View>
              {m.caps.length > 0 && (
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {m.caps.map((c) => <CapBadge key={c} label={c} active />)}
                </View>
              )}
              {m.premium && (
                <Text style={{ color: "#fbbf24", fontSize: 8.5, letterSpacing: 1, borderWidth: 1, borderColor: "rgba(251,191,36,.4)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>{t("premium")}</Text>
              )}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

function PrimaryBtn({ title, onPress, theme }: { title: string; onPress: () => void; theme: any }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: theme.accent, borderRadius: 11, paddingVertical: 13, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.name === "dark" ? "#1c1202" : "#fdf9f2", fontSize: 14, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

function Bubble({ msg, theme, onCopy, onShare }: { msg: Msg; theme: any; onCopy: () => void; onShare: () => void }) {
  const user = msg.role === "user";
  const align: "flex-end" | "flex-start" = user ? "flex-end" : "flex-start";
  const containerStyle = { alignSelf: align, maxWidth: "86%" as const, marginBottom: 10 };
  if (msg.streaming) {
    return (
      <View style={containerStyle}>
        <View style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderStyle: "dashed" }}>
          <Text style={{ color: theme.dim, fontSize: 12 }}>▊</Text>
        </View>
      </View>
    );
  }
  if (msg.error && !msg.content) {
    return (
      <View style={containerStyle}>
        <View style={{ padding: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.danger, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{msg.error}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={containerStyle}>
      <View style={{ backgroundColor: user ? theme.userBubble : theme.surface, borderRadius: 14, borderTopLeftRadius: user ? 14 : 4, borderTopRightRadius: user ? 14 : 14, borderWidth: user ? 0 : 1, borderColor: user ? undefined : theme.border, paddingHorizontal: 13, paddingVertical: 9 }}>
        {user ? (
          <Text style={{ color: theme.userText, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
        ) : (
          renderMarkdown(msg.content, theme)
        )}
      </View>
      <View style={{ flexDirection: "row", justifyContent: user ? "flex-end" : "flex-start", marginTop: 4, gap: 12 }}>
        <Pressable onPress={onCopy} hitSlop={8}><Text style={{ color: theme.mute, fontSize: 11 }}>copy</Text></Pressable>
        <Pressable onPress={onShare} hitSlop={8}><Text style={{ color: theme.mute, fontSize: 11 }}>share</Text></Pressable>
      </View>
    </View>
  );
}