/**
 * Чат — основной экран. Прямой канал к провайдеру (core/gateway).
 * Сессии выезжают снизу (bottom sheet), модели — тоже sheet.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { MaterialIcons } from "@expo/vector-icons";

import { useApp, genId, Msg, Session } from "../store/AppStore";
import { ModelInfo, streamChat } from "../core/gateway";
import { CapBadge } from "../components/ui";
import { renderMarkdown } from "../components/Markdown";
import { IconButton, IconName } from "../design-system/components/IconButton";
import { Sheet } from "../design-system/components/Sheet";
import { Button } from "../design-system/components/Button";
import { Input } from "../design-system/components/Input";
import { showToast } from "../design-system/components/Toast";

export function ChatScreen() {
  const { state, theme, dispatch, t, newSession, setActive, deleteSession, setDefaultModel } = useApp();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [msgMenuTarget, setMsgMenuTarget] = useState<Msg | null>(null);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [editTarget, setEditTarget] = useState<Msg | null>(null);
  const [editValue, setEditValue] = useState("");
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const allModels = [...state.models, ...state.customModels];
  const model = allModels.find((m) => m.modelName === active?.modelId) ?? allModels[0];
  const modelName = model?.displayName ?? "Aso";

  const scrollBottom = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const copyMsg = (m: Msg) => Clipboard.setStringAsync(m.content).catch(() => {});
  const shareMsg = (m: Msg) => Share.share({ message: m.content }).catch(() => {});

  const sendText = useCallback(
    async (raw: string) => {
      const content = raw.trim();
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
      // ВАЖНО: включаем текущее сообщение в историю — иначе модель не видит вопрос.
      const history: { role: "user" | "assistant"; content: string }[] = [
        ...(cur?.messages ?? [])
          .filter((m) => !m.streaming && !m.error)
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];

      const aiId = genId();
      dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: aiId, role: "assistant", content: "", streaming: true } });

      let acc = "";
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await streamChat(model, history, {
        onToken: (tok) => {
          if (stopRef.current) return;
          acc += tok;
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
          scrollBottom();
        },
        onDone: (clean) => {
          setStreaming(false);
          if (stopRef.current && !clean) return; // отменено пользователем — не трогаем
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
            patch: { content: clean || acc || (stopRef.current ? "" : "(пусто)"), streaming: false },
          });
        },
        onError: (err) => {
          setStreaming(false);
          if (stopRef.current) return; // abort по Стоп — не показываем ошибку
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
            patch: { streaming: false, error: err, content: acc || "" },
          });
        },
      }, ctrl.signal);
    },
    [text, streaming, active, dispatch, model, setActive, scrollBottom],
  );

  const send = useCallback(() => {
    if (text.trim()) sendText(text);
  }, [text, sendText]);

  // Повтор последнего запроса (для ошибок AI-сообщения)
  const retryMsg = useCallback(
    (m: Msg) => {
      if (!active || !m.role) return;
      const idx = active.messages.findIndex((x) => x.id === m.id);
      for (let j = idx - 1; j >= 0; j--) {
        const prev = active.messages[j];
        if (prev.role === "user") {
          sendText(prev.content);
          return;
        }
      }
    },
    [active, sendText],
  );

  const msgMenu = useCallback(
    (m: Msg) => {
      setMsgMenuTarget(m);
    },
    [],
  );

  const doDeleteMsg = useCallback(
    (m: Msg) => {
      if (active) {
        dispatch({ type: "DELETE_MSG", sessionId: active.id, msgId: m.id });
        showToast("ok", "Сообщение удалено");
      }
      setMsgMenuTarget(null);
    },
    [active, dispatch],
  );

  const handleNewSession = useCallback(() => {
    const id = newSession();
    setActive(id);
    setSessionsOpen(false);
    setText("");
  }, [newSession, setActive]);

  const deleteSessionById = useCallback(
    (sid: string) => {
      const cur = state.sessions.find((s) => s.id === sid);
      if (cur) setDeleteTarget(cur);
    },
    [state.sessions],
  );

  const confirmDeleteSession = useCallback(() => {
    if (!deleteTarget) return;
    deleteSession(deleteTarget.id);
    setSessionsOpen(false);
    setDeleteTarget(null);
  }, [deleteTarget, deleteSession]);

  const renameSessionById = useCallback(
    (sid: string) => {
      const cur = state.sessions.find((s) => s.id === sid);
      if (!cur) return;
      setRenameValue(cur.name);
      setRenameTarget(cur);
    },
    [state.sessions],
  );

  // «Изменить» пользовательское сообщение: открываем sheet с текущим текстом
  const startEdit = useCallback(
    (m: Msg) => {
      if (m.role !== "user") return;
      setEditValue(m.content);
      setEditTarget(m);
    },
    [],
  );

  /**
   * Сохранить отредактированный вопрос и заново получить ответ.
   * 1) обновляем текст user-сообщения,
   * 2) удаляем все сообщения ПОСЛЕ него (старый ответ ИИ),
   * 3) стримим новый ответ от модели.
   */
  const confirmEdit = useCallback(async () => {
    if (!active || !editTarget) return;
    const newText = editValue.trim();
    if (!newText) return;
    const sid = active.id;
    const idx = active.messages.findIndex((m) => m.id === editTarget.id);
    if (idx < 0) return;

    // обновляем текст вопроса
    dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: editTarget.id, patch: { content: newText } });
    // удаляем всё, что идёт после вопроса (старый ответ и хвост)
    for (const m of active.messages.slice(idx + 1)) {
      dispatch({ type: "DELETE_MSG", sessionId: sid, msgId: m.id });
    }
    setEditTarget(null);
    setEditValue("");
    setStreaming(true);
    stopRef.current = false;

    // история: все до вопроса включительно, с отредактированным текстом
    const history: { role: "user" | "assistant"; content: string }[] = active.messages
      .slice(0, idx + 1)
      .filter((m) => !m.streaming && !m.error)
      .map((m, j) => ({
        role: m.role,
        content: j === idx ? newText : m.content,
      }));

    if (!model) return;
    const aiId = genId();
    dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: aiId, role: "assistant", content: "", streaming: true } });

    let acc = "";
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    await streamChat(model, history, {
      onToken: (tok) => {
        if (stopRef.current) return;
        acc += tok;
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
        scrollBottom();
      },
      onDone: (clean) => {
        setStreaming(false);
        if (stopRef.current && !clean) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { content: clean || acc || (stopRef.current ? "" : "(пусто)"), streaming: false },
        });
      },
      onError: (err) => {
        setStreaming(false);
        if (stopRef.current) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { streaming: false, error: err, content: acc || "" },
        });
      },
    }, ctrl.signal);
  }, [active, editTarget, editValue, model, dispatch, scrollBottom]);

  const confirmRename = useCallback(() => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (name) {
      dispatch({ type: "UPDATE_SESSION", sessionId: renameTarget.id, patch: { name } });
      showToast("ok", "Сессия переименована");
    }
    setRenameTarget(null);
  }, [renameTarget, renameValue, dispatch]);

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
      // запоминаем выбранную модель для новых сессий (персист между запусками)
      setDefaultModel(m.modelName);
      setModelsOpen(false);
    },
    [active, dispatch, setActive, setDefaultModel, t],
  );

  const sessionList = [...state.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((s) => !search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8, paddingTop: insets.top + 4, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bg }}>
        <IconButton name="menu" onPress={() => setSessionsOpen(true)} accessibilityLabel={t("sessions")} />
        <Pressable onPress={() => setModelsOpen(true)} style={{ flex: 1, paddingVertical: 6, paddingLeft: 6 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>
            <Text style={{ color: theme.accentHi }}>● </Text>{modelName}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{active?.name ?? t("chat_title")}</Text>
        </Pressable>
        <IconButton name="add" onPress={handleNewSession} accessibilityLabel={t("newSession")} />
      </View>

      {/* messages */}
      {(!active || active.messages.length === 0) ? (
        <EmptyChat theme={theme} hasSession={!!active} />
      ) : (
        <FlatList
          ref={listRef}
          data={active.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          onContentSizeChange={scrollBottom}
          renderItem={({ item }) => (
            <Bubble msg={item} theme={theme} onCopy={() => copyMsg(item)} onShare={() => shareMsg(item)} onEdit={() => startEdit(item)} onLongPress={() => msgMenu(item)} />
          )}
        />
      )}

      {streaming && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
          <Text style={{ color: theme.dim, fontSize: 12 }}>{t("streaming")}</Text>
        </View>
      )}

      {/* input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : insets.top}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 8, backgroundColor: theme.bg }}>
          {/* капсула ввода с кнопкой отправки ВНУТРИ (как на макете) */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: theme.surface2, borderRadius: 22, paddingLeft: 16, paddingRight: 5, paddingTop: 5, paddingBottom: 5, minHeight: 44 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t("message_placeholder")}
              placeholderTextColor={theme.mute}
              multiline
              textAlignVertical="top"
              style={{ flex: 1, fontSize: 14, color: theme.text, maxHeight: 96, paddingTop: 8, paddingBottom: 8, marginRight: 6 }}
            />
            {streaming ? (
              <Pressable onPress={() => { stopRef.current = true; setStreaming(false); abortRef.current?.abort(); }} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="stop" size={18} color="#fff" />
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {/* серебристая 4-конечная звездочка (как на макете) */}
                <MaterialIcons name="auto-awesome" size={13} color="#e8e6e1" style={{ opacity: 0.9 }} />
                <Pressable onPress={send} disabled={!text.trim()} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.accent, opacity: text.trim() ? 1 : 0.45, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="send" size={17} color={theme.onAccent} style={{ transform: [{ rotate: "-30deg" }] }} />
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── Sessions sheet ── */}
      <Sheet visible={sessionsOpen} onClose={() => setSessionsOpen(false)} title={t("sessions")} snapPoints={["70%"]}>
        <Button title={"＋ " + t("newSession")} onPress={handleNewSession} fullWidth />
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск сессий…"
            placeholderTextColor={theme.mute}
            style={{ backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: theme.text, minHeight: 40 }}
          />
        </View>
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable onPress={() => renameSessionById(s.id)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }} accessibilityLabel="Переименовать">
                <MaterialIcons name="edit" size={16} color={theme.accentHi} />
              </Pressable>
              <Pressable onPress={() => deleteSessionById(s.id)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }} accessibilityLabel="Удалить">
                <MaterialIcons name="delete-outline" size={17} color={theme.danger} />
              </Pressable>
            </View>
          </Pressable>
        ))}
      </Sheet>

      {/* ── Models sheet ── */}
      <Sheet visible={modelsOpen} onClose={() => setModelsOpen(false)} title={t("model_select")} snapPoints={["60%"]}>
        {allModels.map((m) => {
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
      </Sheet>

      {/* ── Message actions sheet (in-app, не системный Alert) ── */}
      <Sheet visible={!!msgMenuTarget} onClose={() => setMsgMenuTarget(null)} title={msgMenuTarget?.role === "user" ? "Сообщение" : "Ответ"} snapPoints={["40%"]}>
        {msgMenuTarget && (
          <>
            {msgMenuTarget.role === "assistant" && (msgMenuTarget.error || msgMenuTarget.content) && (
              <Button title="Повторить запрос" variant="secondary" onPress={() => { const m = msgMenuTarget; setMsgMenuTarget(null); retryMsg(m); }} fullWidth style={{ marginTop: 6 }} />
            )}
            <Button title="Копировать" variant="secondary" onPress={() => { copyMsg(msgMenuTarget); setMsgMenuTarget(null); }} fullWidth style={{ marginTop: 6 }} />
            <Button title="Поделиться" variant="secondary" onPress={() => { shareMsg(msgMenuTarget); setMsgMenuTarget(null); }} fullWidth style={{ marginTop: 6 }} />
            <Button title="Удалить сообщение" variant="danger" onPress={() => doDeleteMsg(msgMenuTarget)} fullWidth style={{ marginTop: 6 }} />
          </>
        )}
      </Sheet>

      {/* ── Edit message (изменить отправленное сообщение) ── */}
      <Sheet visible={!!editTarget} onClose={() => setEditTarget(null)} title="Изменить сообщение" snapPoints={["38%"]}>
        {editTarget && (
          <>
            <Text style={{ color: theme.dim, fontSize: 12, marginBottom: 6 }}>
              ИИ ответит заново на изменённый вопрос.
            </Text>
            <Input
              value={editValue}
              onChangeText={setEditValue}
              placeholder="Новый текст сообщения"
              multiline
              autoFocus
              style={{ minHeight: 80, marginTop: 2 }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title="Отмена" variant="secondary" onPress={() => setEditTarget(null)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Обновить и ответить" onPress={confirmEdit} disabled={!editValue.trim() || streaming} fullWidth />
              </View>
            </View>
          </>
        )}
      </Sheet>

      {/* ── Rename session (in-app, Alert.prompt на Android не работает) ── */}
      <Sheet visible={!!renameTarget} onClose={() => setRenameTarget(null)} title="Переименовать сессию" snapPoints={["35%"]}>
        {renameTarget && (
          <>
            <Input
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Название сессии"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmRename}
              style={{ marginTop: 4 }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title="Отмена" variant="secondary" onPress={() => setRenameTarget(null)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Сохранить" onPress={confirmRename} fullWidth />
              </View>
            </View>
          </>
        )}
      </Sheet>

      {/* ── Delete session confirm (in-app) ── */}
      <Sheet visible={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Удалить сессию?" snapPoints={["32%"]}>
        {deleteTarget && (
          <>
            <Text style={{ color: theme.dim, fontSize: 13, lineHeight: 19 }}>
              «{deleteTarget.name}» и все её сообщения будут удалены безвозвратно.
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title="Отмена" variant="secondary" onPress={() => setDeleteTarget(null)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Удалить" variant="danger" onPress={confirmDeleteSession} fullWidth />
              </View>
            </View>
          </>
        )}
      </Sheet>
    </View>
  );
}

function Bubble({ msg, theme, onCopy, onShare, onEdit, onLongPress }: { msg: Msg; theme: any; onCopy: () => void; onShare: () => void; onEdit?: () => void; onLongPress?: () => void }) {
  const user = msg.role === "user";
  const align: "flex-end" | "flex-start" = user ? "flex-end" : "flex-start";
  const containerStyle = { alignSelf: align, maxWidth: "86%" as const, marginBottom: 10 };
  if (msg.streaming) {
    return (
      <View style={containerStyle}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accentHi }} />
            ))}
          </View>
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
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
      <View style={{ backgroundColor: user ? theme.userBubble : theme.surface, borderRadius: 14, borderTopLeftRadius: user ? 14 : 4, borderTopRightRadius: user ? 14 : 14, borderWidth: user ? 0 : 1, borderColor: user ? undefined : theme.border, paddingHorizontal: 13, paddingVertical: 9 }}>
        {user ? (
          <Text style={{ color: theme.userText, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
        ) : (
          renderMarkdown(msg.content, theme)
        )}
      </View>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: user ? "flex-end" : "flex-start", marginTop: 4, gap: 14 }}>
        <Pressable onPress={onCopy} hitSlop={10} accessibilityLabel="Копировать" style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <MaterialIcons name="content-copy" size={12} color={theme.mute} />
          <Text style={{ color: theme.mute, fontSize: 10.5 }}>Копировать</Text>
        </Pressable>
        <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="Поделиться" style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <MaterialIcons name="share" size={12} color={theme.mute} />
          <Text style={{ color: theme.mute, fontSize: 10.5 }}>Поделиться</Text>
        </Pressable>
        {/* «Изменить» — только иконка, без текста (значок сам объясняет) */}
        {user && onEdit && (
          <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Изменить сообщение">
            <MaterialIcons name="edit" size={12} color={theme.mute} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ── Пустое состояние чата: круглое пульсирующее лого + бесконечные волны ── */

// RN-web плохо дружит с Animated.loop (гасит opacity) — на web отдаём
// статичный видимый блок, на нативе — полную бесконечную анимацию.
const IS_NATIVE = Platform.OS === "android" || Platform.OS === "ios";

function EmptyChat({ theme, hasSession }: { theme: any; hasSession: boolean }) {
  if (!IS_NATIVE) {
    return <EmptyChatStatic theme={theme} hasSession={hasSession} />;
  }
  return <EmptyChatAnimated theme={theme} hasSession={hasSession} />;
}

/** Web-версия: лого всегда видно, волны статичны (RN-web ломает loop). */
function EmptyChatStatic({ theme, hasSession }: { theme: any; hasSession: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
      <View style={{ width: 168, height: 168, alignItems: "center", justifyContent: "center", marginBottom: 26 }}>
        {/* статичные волны */}
        <View style={{ position: "absolute", width: 204, height: 204, borderRadius: 102, borderWidth: 1.5, borderColor: theme.accentHi, opacity: 0.35 }} />
        <View style={{ position: "absolute", width: 178, height: 178, borderRadius: 89, borderWidth: 1.5, borderColor: theme.accent, opacity: 0.45 }} />
        {/* свечение */}
        <View style={{ position: "absolute", width: 152, height: 152, borderRadius: 76, backgroundColor: theme.accent, opacity: 0.4 }} />
        <Image
          source={require("../../assets/logo.png")}
          style={{ width: 132, height: 132, borderRadius: 66 }}
        />
      </View>
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3 }}>
        Привет! Чем займёмся сегодня?
      </Text>
      <Text style={{ color: theme.dim, fontSize: 13.5, textAlign: "center", lineHeight: 20, maxWidth: 260 }}>
        Задай вопрос или дай задачу — бот ответит в потоке.
      </Text>
      {hasSession && (
        <Text style={{ color: theme.mute, fontSize: 11, marginTop: 14 }}>
          Это новая сессия — первое сообщение начнёт её.
        </Text>
      )}
    </View>
  );
}

/** Нативная версия: круглое лого, бесконечный пульс + расходящиеся волны. */
function EmptyChatAnimated({ theme, hasSession }: { theme: any; hasSession: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    // пульс логотипа — бесконечно
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();

    // волны: три кольца с фазовым сдвигом, бесконечно расходятся
    const waveLoop = (w: Animated.Value, offset: number) => {
      const loop = Animated.loop(
        Animated.timing(w, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }),
      );
      // старт с фазы offset (0/0.33/0.66)
      w.setValue(offset);
      loop.start();
      return loop;
    };
    const wl1 = waveLoop(wave1, 0);
    const wl2 = waveLoop(wave2, 0.33);
    const wl3 = waveLoop(wave3, 0.66);

    return () => {
      pulseLoop.stop();
      wl1.stop();
      wl2.stop();
      wl3.stop();
    };
  }, [fade, pulse, wave1, wave2, wave3]);

  const logoScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const logoGlow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });

  const wave = (w: Animated.Value) => ({
    opacity: w.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.9, 0.4, 0] }),
    scale: w.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }),
  });

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
      <Animated.View style={{ opacity: fade, alignItems: "center" }}>
        <View style={{ width: 168, height: 168, alignItems: "center", justifyContent: "center", marginBottom: 26 }}>
          {/* бесконечные волны-кольца */}
          {[wave1, wave2, wave3].map((w, i) => {
            const s = wave(w);
            return (
              <Animated.View
                key={i}
                style={{
                  position: "absolute", width: 132, height: 132, borderRadius: 66,
                  borderWidth: 2, borderColor: theme.accentHi,
                  opacity: s.opacity, transform: [{ scale: s.scale }],
                }}
              />
            );
          })}
          {/* свечение-ореол */}
          <Animated.View
            style={{
              position: "absolute", width: 152, height: 152, borderRadius: 76,
              backgroundColor: theme.accent, opacity: logoGlow, transform: [{ scale: logoScale }],
            }}
          />
          <Animated.Image
            source={require("../../assets/logo.png")}
            style={{ width: 132, height: 132, borderRadius: 66, transform: [{ scale: logoScale }] }}
          />
        </View>

        <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3 }}>
          Привет! Чем займёмся сегодня?
        </Text>
        <Text style={{ color: theme.dim, fontSize: 13.5, textAlign: "center", lineHeight: 20, maxWidth: 260 }}>
          Задай вопрос или дай задачу — бот ответит в потоке.
        </Text>
        {hasSession && (
          <Text style={{ color: theme.mute, fontSize: 11, marginTop: 14 }}>
            Это новая сессия — первое сообщение начнёт её.
          </Text>
        )}
      </Animated.View>
    </View>
  );
}