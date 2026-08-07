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
import { ThinkingBlock } from "../components/kimi/ThinkingBlock";
import { ToolCard } from "../components/kimi/ToolCard";
import { StorageSheet } from "../components/kimi/StorageSheet";
import { fonts } from "../theme/tokens";
import {
  VibeProject,
  listProjects,
  treeFiles,
  listFiles,
  parseFileBlocks,
  writeFile,
} from "../core/vibeLocal";
import { openInTermux, openFolderInFileManager } from "../core/termux";
import { IconButton, IconName } from "../design-system/components/IconButton";
import { GlassPressable } from "../design-system/components/Glass";
import { GlassBackdrop } from "../design-system/components/GlassBackdrop";
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
  // ── окно хранилища (проекты + файлы + инструкции, как у Hermes) ──
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const allModels = [...state.models, ...state.customModels];
  const model = allModels.find((m) => m.modelName === active?.modelId) ?? allModels[0];
  const modelName = model?.displayName ?? "Aso";
  // Активный vibe-проект сессии (контекст агента).
  const activeProject = active?.projectId
    ? projects.find((p) => p.id === active.projectId) ?? null
    : null;

  const scrollBottom = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  // ── Проекты: окно «всё в одном чате» ──
  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      const withFiles = await Promise.all(
        list.map(async (p) => {
          const files = await listFiles(p.id).catch(() => []);
          return { ...p, fileCount: files.length };
        }),
      );
      setProjects(withFiles as any);
    } catch {}
  }, []);

  const openStorageSheet = useCallback(() => {
    loadProjects();
    setStorageOpen(true);
  }, [loadProjects]);

  /**
   * Выбор проекта: находим/создаём сессию, привязанную к проекту.
   * Каждый проект = свой вайбкод (своя история). «Без проекта» = обычный чат.
   */
  const selectProject = useCallback(
    (p: VibeProject | null) => {
      setStorageOpen(false);
      if (!p) {
        // отвязать: только если у сессии нет проекта — вернуть в обычный чат
        if (active?.projectId) {
          dispatch({ type: "UPDATE_SESSION", sessionId: active.id, patch: { projectId: null } });
        }
        return;
      }
      // уже открыта сессия этого проекта?
      let sid = state.sessions.find((s) => s.projectId === p.id)?.id;
      if (!sid) {
        sid = genId();
        dispatch({
          type: "ADD_SESSION",
          session: {
            id: sid, name: p.name, messages: [], modelId: null,
            createdAt: Date.now(), updatedAt: Date.now(), projectId: p.id,
          },
        });
      }
      setActive(sid);
      setText("");
    },
    [active, dispatch, state.sessions, setActive],
  );

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

      // ── Контекст проекта (как в Kimi: выбрал проект → агент знает, о чём речь) ──
      const proj = cur?.projectId ? projects.find((p) => p.id === cur.projectId) : null;
      let chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = history;
      if (proj) {
        const tree = await treeFiles(proj.id).catch(() => "(ошибка чтения)");
        const ctx =
          `Ты работаешь в проекте «${proj.name}».` +
          (proj.desc ? `\nОписание: ${proj.desc}` : "") +
          `\nФайлы проекта:\n${tree}` +
          `\n\nКогда нужно создать или изменить файл — выводи блок в формате:\n[FILE: путь/имя.файла]\n\`\`\`язык\nсодержимое\n\`\`\`\nПосле блоков дай краткое резюме (2-4 предложения).`;
        chatMessages = [{ role: "system", content: ctx }, ...history];
      }

      const aiId = genId();
      dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: aiId, role: "assistant", content: "", streaming: true } });

      let acc = "";
      let written: string[] = [];
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await streamChat(model, chatMessages, {
        onToken: (tok) => {
          if (stopRef.current) return;
          acc += tok;
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
          scrollBottom();
          // tool-событие: агент начал писать файл — карточка как в Kimi
          if (proj) {
            const fm = acc.match(/\[FILE:\s*([^\n\]]+)\]/);
            if (fm && !written.includes("__showed_" + fm[1])) {
              written.push("__showed_" + fm[1]);
              dispatch({
                type: "ADD_MSG",
                sessionId: sid,
                msg: { id: genId(), role: "assistant", content: "", tool: "пишу " + fm[1].trim() },
              });
            }
          }
        },
        onThinking: (thinking) => {
          if (stopRef.current) return;
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { thinking } });
        },
        onDone: async (clean) => {
          setStreaming(false);
          if (stopRef.current && !clean) return; // отменено пользователем — не трогаем
          let finalText = clean || acc || (stopRef.current ? "" : "(пусто)");
          if (proj) {
            const blocks = parseFileBlocks(finalText || acc);
            for (const b of blocks) {
              try {
                await writeFile(proj.id, b.path, b.content);
              } catch (e: any) {
                dispatch({
                  type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
                  patch: { streaming: false, error: `не удалось записать ${b.path}: ${e?.message || e}`, content: acc || "" },
                });
                return;
              }
            }
            finalText = (finalText || acc).replace(/\[FILE:[^\]]+\]\s*```[^\n]*\n[\s\S]*?```/g, "").trim() || acc;
          }
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
            patch: { content: finalText, streaming: false },
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
      onThinking: (thinking) => {
        if (stopRef.current) return;
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { thinking } });
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
      {/* светящиеся пятна под всем стеклом — чтобы глэссморфизм был виден */}
      <GlassBackdrop fixed />
      {/* header: круглые стеклянные кнопки + капсулы (всё скруглённое, как Kimi) */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 10, paddingTop: insets.top + 6 }}>
        <IconButton name="menu" size={19} onPress={() => setSessionsOpen(true)} accessibilityLabel={t("sessions")} />

        {/* капсула модели — стекло */}
        <GlassPressable
          onPress={() => setModelsOpen(true)}
          radius={22}
          style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, height: 44 }}
          accessibilityLabel={t("model_select")}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accentHi }} />
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600", fontFamily: fonts.sansDemi }} numberOfLines={1}>
            {modelName}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={16} color={theme.mute} />
        </GlassPressable>

        {/* капсула хранилища (проекты + файлы + инструкции) — как хранилище Hermes */}
        <GlassPressable
          onPress={openStorageSheet}
          radius={22}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            paddingHorizontal: 12, height: 44, flexShrink: 1,
          }}
          accessibilityLabel="Хранилище"
        >
          <MaterialIcons name="inventory-2" size={15} color={activeProject ? theme.accentHi : theme.mute} />
          <Text numberOfLines={1} style={{ color: activeProject ? theme.accentHi : theme.dim, fontSize: 12, fontFamily: fonts.mono, flexShrink: 1 }}>
            {activeProject ? activeProject.name : "Хранилище"}
          </Text>
          {activeProject ? (
            <Pressable onPress={() => selectProject(null)} hitSlop={8} accessibilityLabel="Отвязать проект">
              <MaterialIcons name="close" size={14} color={theme.mute} />
            </Pressable>
          ) : (
            <MaterialIcons name="keyboard-arrow-down" size={15} color={theme.mute} />
          )}
        </GlassPressable>

        <IconButton name="add" size={19} onPress={handleNewSession} accessibilityLabel={t("newSession")} />
      </View>

      {/* messages */}
      {(!active || active.messages.length === 0) ? (
        <EmptyChat theme={theme} />
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
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 8 }}>
          {/* стеклянная широкая капсула ввода: + | placeholder | микрофон/send/stop */}
          <GlassPressable
            radius={24}
            intensity={52}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 4, paddingRight: 4, paddingVertical: 4, minHeight: 52 }}
            accessibilityLabel="Поле ввода"
          >
            <Pressable
              onPress={() => showToast("info", "Прикрепить файл — скоро")}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
                backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.6)",
                borderWidth: 1, borderColor: theme.border, opacity: pressed ? 0.7 : 1,
              })}
              accessibilityLabel="Прикрепить"
            >
              <MaterialIcons name="add" size={20} color={theme.dim} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t("message_placeholder")}
              placeholderTextColor={theme.mute}
              multiline
              textAlignVertical="center"
              style={{ flex: 1, fontSize: 14, color: theme.text, maxHeight: 92, paddingVertical: 8, marginHorizontal: 4, fontFamily: fonts.sansMedium }}
            />
            {streaming ? (
              <Pressable
                onPress={() => { stopRef.current = true; setStreaming(false); abortRef.current?.abort(); }}
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Остановить"
              >
                <MaterialIcons name="stop" size={18} color="#fff" />
              </Pressable>
            ) : text.trim() ? (
              <Pressable
                onPress={send}
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Отправить"
              >
                <MaterialIcons name="arrow-upward" size={19} color={theme.onAccent} />
              </Pressable>
            ) : (
              <Pressable
                style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.6)", borderWidth: 1, borderColor: theme.border }}
                accessibilityLabel="Голосовой ввод"
              >
                <MaterialIcons name="mic" size={18} color={theme.dim} />
              </Pressable>
            )}
          </GlassPressable>
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
                <Text style={{ color: theme.warn, fontSize: 8.5, letterSpacing: 1, borderWidth: 1, borderColor: theme.warn + "66", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>{t("premium")}</Text>
              )}
            </Pressable>
          );
        })}
      </Sheet>

      {/* ── Хранилище (проекты + файлы + инструкции — как хранилище Hermes) ── */}
      <StorageSheet
        visible={storageOpen}
        onClose={() => setStorageOpen(false)}
        activeProjectId={active?.projectId ?? null}
        onSelectProject={selectProject}
      />

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
  // Карточка инструмента — до контента, слева (как у Kimi).
  if (msg.tool) {
    return (
      <View style={containerStyle}>
        <ToolCard tool={msg.tool} state={msg.toolState ?? "loading"} theme={theme} />
      </View>
    );
  }
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
          <>
            {msg.thinking ? (
              <ThinkingBlock
                text={msg.thinking}
                status={msg.streaming ? "thinking" : "done"}
                theme={theme}
              />
            ) : null}
            {renderMarkdown(msg.content, theme)}
          </>
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

/* ── Пустой экран: только приветственный текст (сверху, не по центру) ── */
function EmptyChat({ theme }: { theme: any }) {
  return (
    <View style={{ flex: 1, paddingTop: 46, paddingHorizontal: 22 }}>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontFamily: fonts.mono, lineHeight: 31 }}>
        Привет!{"\n"}Чем займёмся сегодня?
      </Text>
      <Text style={{ color: theme.dim, fontSize: 13.5, marginTop: 12, lineHeight: 21 }}>
        Спроси что угодно — помогу с кодом, проектами и задачами.
      </Text>
    </View>
  );
}
