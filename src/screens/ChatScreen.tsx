/**
 * Чат — основной экран. Прямой канал к провайдеру (core/gateway).
 * Сессии выезжают снизу (bottom sheet), модели — тоже sheet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { MaterialIcons } from "@expo/vector-icons";

import { useApp, genId, Msg, Session } from "../store/AppStore";
import { ModelInfo, streamChat, ChatMessage, ChatPart } from "../core/gateway";
import { buildAttachmentParts } from "../core/attachments";
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
import { Glass, GlassPressable } from "../design-system/components/Glass";
import { GlassBackdrop } from "../design-system/components/GlassBackdrop";
import { Sheet } from "../design-system/components/Sheet";
import { Button } from "../design-system/components/Button";
import { Input } from "../design-system/components/Input";
import { showToast } from "../design-system/components/Toast";

/** Группа сообщений для ленты: chain = блок раздумий+команд, single = обычное сообщение. */
type Group =
  | { id: string; kind: "chain"; msgs: Msg[] }
  | { id: string; kind: "single"; msg: Msg };

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
  // детали команды/раздумий — bottom-sheet как окно сессии
  const [detailTarget, setDetailTarget] = useState<Msg | null>(null);
  // прикрепление: окно-меню (фото/камера/файл) и выбранное вложение
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachment, setAttachment] = useState<{ kind: "image" | "file"; uri: string; name?: string } | null>(null);
  // ── окно хранилища (проекты + файлы + инструкции, как у Hermes) ──
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<any>>(null);

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

  // ── Прикрепление: фото (галерея), камера, файл — всё рабочее ──
  const pickImage = useCallback(async () => {
    setAttachOpen(false);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setAttachment({ kind: "image", uri: res.assets[0].uri, name: res.assets[0].fileName ?? "photo" });
      }
    } catch (e: any) {
      showToast("err", `Не удалось открыть галерею: ${e?.message || "ошибка"}`);
    }
  }, []);

  const pickCamera = useCallback(async () => {
    setAttachOpen(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showToast("err", "Нет доступа к камере");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setAttachment({ kind: "image", uri: res.assets[0].uri, name: res.assets[0].fileName ?? "photo" });
      }
    } catch (e: any) {
      showToast("err", `Не удалось открыть камеру: ${e?.message || "ошибка"}`);
    }
  }, []);

  const pickFile = useCallback(async () => {
    setAttachOpen(false);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (!res.canceled && res.assets?.[0]) {
        setAttachment({ kind: "file", uri: res.assets[0].uri, name: res.assets[0].name ?? "файл" });
      }
    } catch (e: any) {
      showToast("err", `Не удалось выбрать файл: ${e?.message || "ошибка"}`);
    }
  }, []);

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

      dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: genId(), role: "user", content, ...(attachment ? (attachment.kind === "image" ? { image: attachment.uri } : { file: { name: attachment.name ?? "файл", uri: attachment.uri } }) : {}) } });
      setAttachment(null);
      setText("");
      setStreaming(true);
      stopRef.current = false;
      scrollBottom();

      const cur = state.sessions.find((s) => s.id === sid);
      // ВАЖНО: включаем текущее сообщение в историю — иначе модель не видит вопрос.
      // Вложения (фото/файл) превращаются в части сообщения (vision/текст).
      const buildHistoryMsg = async (m: Msg | null, extraParts: ChatPart[], overrideText?: string): Promise<ChatMessage> => {
        const parts: ChatPart[] = [];
        const content = (overrideText ?? m?.content ?? "").trim();
        if (content) parts.push({ type: "text", text: content });
        if (m?.image) {
          const p = await buildAttachmentParts("image", m.image, m.file?.name).catch(() => [] as ChatPart[]);
          parts.push(...p);
        } else if (m?.file) {
          const p = await buildAttachmentParts("file", m.file.uri, m.file.name).catch(() => [] as ChatPart[]);
          parts.push(...p);
        }
        parts.push(...extraParts);
        return { role: m?.role === "assistant" ? "assistant" : "user", content: parts.length ? parts : content };
      };

      // Текущее вложение (ещё не сохранено в Msg) — строим parts.
      let attachParts: ChatPart[] = [];
      if (attachment) {
        attachParts = await buildAttachmentParts(attachment.kind, attachment.uri, attachment.name).catch(() => [] as ChatPart[]);
      }

      const prev: ChatMessage[] = [];
      for (const m of (cur?.messages ?? []).filter((x) => !x.streaming && !x.error).slice(-20)) {
        prev.push(await buildHistoryMsg(m, []));
      }
      const history: ChatMessage[] = [
        ...prev,
        await buildHistoryMsg(null, attachParts, content),
      ];

      // ── Контекст проекта (как в Kimi: выбрал проект → агент знает, о чём речь) ──
      const proj = cur?.projectId ? projects.find((p) => p.id === cur.projectId) : null;
      let chatMessages: ChatMessage[] = history;
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
    [text, streaming, active, dispatch, model, setActive, scrollBottom, attachment],
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

    // история: все до вопроса включительно, с отредактированным текстом.
    // Вложения (image/file) сохраняются как части сообщения.
    const buildMsg = async (m: Msg, j: number): Promise<ChatMessage> => {
      const parts: ChatPart[] = [];
      const text = (j === idx ? newText : m.content).trim();
      if (text) parts.push({ type: "text", text });
      if (m.image) {
        const p = await buildAttachmentParts("image", m.image, m.file?.name).catch(() => [] as ChatPart[]);
        parts.push(...p);
      } else if (m.file) {
        const p = await buildAttachmentParts("file", m.file.uri, m.file.name).catch(() => [] as ChatPart[]);
        parts.push(...p);
      }
      return { role: m.role, content: parts.length ? parts : text };
    };
    const history: ChatMessage[] = [];
    for (const [j, m] of active.messages.slice(0, idx + 1).entries()) {
      if (m.streaming || m.error) continue;
      history.push(await buildMsg(m, j));
    }

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

  // Цепочки: подряд идущие assistant-сообщения с thinking/tool (без итога) —
  // накапливаются в ОДНОМ стеклянном блоке (как в QIWI); итог агента — отдельный Bubble.
  const chainGroups = useMemo(() => {
    const groups: Group[] = [];
    const msgs = active?.messages ?? [];
    let chain: Msg[] = [];
    const isChainMsg = (m: Msg) =>
      m.role === "assistant" && !m.error && !m.content && (m.thinking || m.tool);
    const flush = () => {
      if (chain.length) {
        groups.push({ id: "chain-" + chain[0].id, kind: "chain", msgs: chain });
        chain = [];
      }
    };
    for (const m of msgs) {
      if (isChainMsg(m)) chain.push(m);
      else {
        flush();
        groups.push({ id: m.id, kind: "single", msg: m });
      }
    }
    flush();
    return groups;
  }, [active?.messages]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* светящиеся пятна под всем стеклом — чтобы глэссморфизм был виден */}
      <GlassBackdrop fixed />

      {/* плавающие кнопки шапки: без полосы, каждая со своим стеклом, сообщения проходят ПОД ними */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}
      >
        <View
          pointerEvents="box-none"
          style={{
            flexDirection: "row", alignItems: "center",
            paddingHorizontal: 10, paddingTop: insets.top + 6,
          }}
        >
          {/* левая группа: меню — симметрично с правым «+» */}
          <IconButton name="menu" size={20} onPress={() => setSessionsOpen(true)} accessibilityLabel={t("sessions")} />

          {/* центральная группа: модель + конфиг — по центру экрана, растянута flex 1 */}
          <View pointerEvents="box-none" style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}>
            {/* капсула модели — стекло */}
            <GlassPressable
              onPress={() => setModelsOpen(true)}
              radius={99}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, height: 42, maxWidth: 130 }}
              accessibilityLabel={t("model_select")}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accentHi }} />
              <Text style={{ color: theme.text, fontSize: 12.5, fontWeight: "600", fontFamily: fonts.sansDemi, flexShrink: 1 }} numberOfLines={1}>
                {modelName}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={15} color={theme.mute} />
            </GlassPressable>

            {/* капсула хранилища (проекты + файлы + инструкции) — единый стиль с кнопкой модели */}
            <GlassPressable
              onPress={openStorageSheet}
              radius={99}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: 16, height: 42, maxWidth: 152,
              }}
              accessibilityLabel="Конфиг"
            >
              <MaterialIcons name="folder" size={16} color={theme.accentHi} />
              <Text numberOfLines={1} style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: "600", fontFamily: fonts.sansDemi, flexShrink: 1 }}>
                {activeProject ? activeProject.name : "Конфиг"}
              </Text>
              {activeProject ? (
                <Pressable onPress={() => selectProject(null)} hitSlop={8} accessibilityLabel="Отвязать проект">
                  <MaterialIcons name="close" size={15} color={theme.mute} />
                </Pressable>
              ) : (
                <MaterialIcons name="keyboard-arrow-down" size={15} color={theme.mute} />
              )}
            </GlassPressable>
          </View>

          {/* правая группа: новый чат — зеркально меню */}
          <IconButton name="add" size={20} onPress={handleNewSession} accessibilityLabel={t("newSession")} />
        </View>
      </View>

      {/* messages — контент скроллится ПОД плавающей шапкой */}
      {(!active || active.messages.length === 0) ? (
        <EmptyChat theme={theme} topInset={insets.top} />
      ) : (
        <FlatList<Group>
          ref={listRef}
          data={chainGroups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ padding: 16, paddingTop: insets.top + 64, paddingBottom: 24 }}
          onContentSizeChange={scrollBottom}
          renderItem={({ item: g, index }) => {
            if (g.kind === "chain") {
              // единый блок: раздумья + команды накапливаются внутри (как в QIWI)
              const onDetail = (m: Msg) => setDetailTarget(m);
              return (
                <View style={{ width: "94%", alignSelf: "flex-start", marginBottom: 10 }}>
                  <Glass radius={20} style={{ overflow: "hidden", width: "100%", paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12 }}>
                    {g.msgs.map((m, i) => {
                      const last = i === g.msgs.length - 1;
                      return (
                        <View key={m.id}>
                          {m.thinking ? (
                            <ThinkingBlock
                              text={m.thinking}
                              status={m.streaming ? "thinking" : "done"}
                              theme={theme}
                              onOpen={() => onDetail(m)}
                              bare
                            />
                          ) : null}
                          {m.tool ? (
                            <ToolCard
                              tool={m.tool}
                              state={m.toolState ?? "loading"}
                              output={m.toolOutput}
                              theme={theme}
                              onOpen={() => onDetail(m)}
                              bare
                            />
                          ) : null}
                          {!last && (
                            <View style={{ height: 1, backgroundColor: theme.border, opacity: 0.6 }} />
                          )}
                        </View>
                      );
                    })}
                  </Glass>
                </View>
              );
            }
            const msg = g.msg;
            const next = chainGroups[index + 1];
            const showActions =
              msg.role === "user"
                ? true
                : !msg.tool && (!next || next.kind === "single" && next.msg.role === "user");
            return (
              <Bubble
                msg={msg}
                theme={theme}
                onCopy={() => copyMsg(msg)}
                onShare={() => shareMsg(msg)}
                onEdit={() => startEdit(msg)}
                onLongPress={() => msgMenu(msg)}
                showActions={showActions}
                onOpenDetail={setDetailTarget}
              />
            );
          }}
        />
      )}

      {streaming && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
          <Text style={{ color: theme.dim, fontSize: 12 }}>{t("streaming")}</Text>
        </View>
      )}

      {/* input.
        Android: манифест уже ставит windowSoftInputMode=adjustResize — KAV с behavior="height"
        ломает это (инпут прыгает за клавиатуру). На Android полагаемся на нативный resize.
        iOS: behaviour="padding" сдвигает панель над клавиатурой. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 8 }}>
          {/* вложения — НАД капсулой, компактные иконки с крестиком (без имён, placeholder не трогаем) */}
          {attachment && (
            <View style={{ flexDirection: "row", marginBottom: 8, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 18, paddingLeft: 6, paddingRight: 4, paddingVertical: 4 }}>
                {attachment.kind === "image" ? (
                  <Image source={{ uri: attachment.uri }} style={{ width: 28, height: 28, borderRadius: 9 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.accentDim }}>
                    <MaterialIcons name="insert-drive-file" size={15} color={theme.accentHi} />
                  </View>
                )}
                <Pressable onPress={() => setAttachment(null)} hitSlop={8} accessibilityLabel="Убрать вложение" style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }}>
                  <MaterialIcons name="close" size={14} color={theme.mute} />
                </Pressable>
              </View>
            </View>
          )}
          {/* стеклянная капсула ввода: pill, единый padding 8 со всех сторон, gap 8, всё по центру */}
          <Glass
            radius={28}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}
          >
            <Pressable
              onPress={() => setAttachOpen(true)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.6)",
                borderWidth: 1, borderColor: theme.border, opacity: pressed ? 0.7 : 1,
              })}
              accessibilityLabel="Прикрепить"
            >
              <MaterialIcons name="add" size={22} color={theme.dim} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t("message_placeholder")}
              placeholderTextColor={theme.mute}
              multiline
              textAlignVertical="center"
              style={{
                flex: 1, fontSize: 14, color: theme.text,
                fontFamily: fonts.sansMedium,
                textAlignVertical: "center",
                // web: textarea не центрирует текст вертикально — задаём высоту и паддинги,
                // чтобы строка (20px) стояла ровно по центру поля 44
                ...(Platform.OS === "web"
                  ? { height: 44, lineHeight: 20, paddingTop: 12, paddingBottom: 12, maxHeight: undefined }
                  : { minHeight: 44, maxHeight: 76, paddingVertical: 0, lineHeight: 20 }),
              }}
            />
            {streaming ? (
              <Pressable
                onPress={() => { stopRef.current = true; setStreaming(false); abortRef.current?.abort(); }}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Остановить"
              >
                <MaterialIcons name="stop" size={18} color="#fff" />
              </Pressable>
            ) : text.trim() ? (
              <Pressable
                onPress={send}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Отправить"
              >
                <MaterialIcons name="arrow-upward" size={22} color={theme.accent} />
              </Pressable>
            ) : (
              <Pressable
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.6)", borderWidth: 1, borderColor: theme.border }}
                accessibilityLabel="Голосовой ввод"
              >
                <MaterialIcons name="mic" size={20} color={theme.dim} />
              </Pressable>
            )}
          </Glass>
        </View>
      </KeyboardAvoidingView>

      {/* ── Sessions sheet ── */}
      <Sheet visible={sessionsOpen} onClose={() => setSessionsOpen(false)} title={t("sessions")} snapPoints={["auto"]} autoMaxPct={70}>
        <Button title={"＋ " + t("newSession")} onPress={handleNewSession} fullWidth />
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск сессий…"
            placeholderTextColor={theme.mute}
            style={{ backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: theme.text, minHeight: 44 }}
          />
        </View>
        {sessionList.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => { setActive(s.id); setSessionsOpen(false); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: s.id === active?.id ? theme.accent : theme.border, backgroundColor: s.id === active?.id ? theme.accentDim : theme.surface, marginTop: 8 }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13 }}>{s.name}</Text>
              <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2 }}>
                {s.messages.length} · {new Date(s.updatedAt).toLocaleDateString()}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Pressable onPress={() => renameSessionById(s.id)} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Переименовать">
                <MaterialIcons name="edit" size={17} color={theme.dim} />
              </Pressable>
              <Pressable onPress={() => deleteSessionById(s.id)} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Удалить">
                <MaterialIcons name="delete-outline" size={18} color={theme.dim} />
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
              style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accentDim : theme.surface, marginTop: 8 }}
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

      {/* ── Конфиг (проекты + файлы + инструкции — как хранилище Hermes) ── */}
      <StorageSheet
        visible={storageOpen}
        onClose={() => setStorageOpen(false)}
        activeProjectId={active?.projectId ?? null}
        onSelectProject={selectProject}
      />

      {/* ── Message actions sheet (in-app, не системный Alert) ── */}
      <Sheet visible={!!msgMenuTarget} onClose={() => setMsgMenuTarget(null)} title={msgMenuTarget?.role === "user" ? "Сообщение" : "Ответ"} snapPoints={["auto"]} autoMaxPct={55}>
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

      {/* ── Детали команды/раздумий — bottom-sheet как окно сессии ── */}
      <Sheet visible={!!detailTarget} onClose={() => setDetailTarget(null)} title={detailTarget?.tool ? "Ход выполнения" : "Раздумья агента"} snapPoints={["auto"]} autoMaxPct={60}>
        {detailTarget && (
          <>
            {detailTarget.tool ? (
              <Text selectable style={{ color: theme.text, fontSize: 12.5, fontFamily: "monospace", borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: 16, padding: 12, lineHeight: 19 }}>
                {detailTarget.tool.trim()}
                {detailTarget.toolOutput ? `\n\n${detailTarget.toolOutput.trim()}` : ""}
              </Text>
            ) : null}
            {detailTarget.thinking ? (
              <Text selectable style={{ color: theme.dim, fontFamily: "monospace", fontSize: 12.5, lineHeight: 19 }}>
                {detailTarget.thinking.trim()}
              </Text>
            ) : null}
          </>
        )}
      </Sheet>

      {/* ── Edit message (изменить отправленное сообщение) ── */}
      <Sheet visible={!!editTarget} onClose={() => setEditTarget(null)} title="Изменить сообщение" snapPoints={["auto"]} autoMaxPct={65}>
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
                <Button title="Отправить" onPress={confirmEdit} disabled={!editValue.trim() || streaming} fullWidth />
              </View>
            </View>
          </>
        )}
      </Sheet>

      {/* ── Прикрепить: фото / камера / файл — компактное меню без заголовка, закрытие свайпом вниз, кнопки на всю ширину ── */}
      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} snapPoints={["auto"]}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {[
            { icon: "photo-library" as const, label: "Фото", onPress: pickImage },
            { icon: "photo-camera" as const, label: "Камера", onPress: pickCamera },
            { icon: "insert-drive-file" as const, label: "Файл", onPress: pickFile },
          ].map((b) => (
            <GlassPressable
              key={b.label}
              onPress={b.onPress}
              radius={20}
              accessibilityLabel={b.label}
              style={{ flex: 1, aspectRatio: 1 }}
            >
              <MaterialIcons name={b.icon} size={34} color={theme.dim} />
            </GlassPressable>
          ))}
        </View>
      </Sheet>

      {/* ── Rename session (in-app, Alert.prompt на Android не работает) ── */}
      <Sheet visible={!!renameTarget} onClose={() => setRenameTarget(null)} title="Переименовать сессию" snapPoints={["auto"]} autoMaxPct={50}>
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
      <Sheet visible={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Удалить сессию?" snapPoints={["auto"]} autoMaxPct={50}>
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

function Bubble({ msg, theme, onCopy, onShare, onEdit, onLongPress, showActions, onOpenDetail }: { msg: Msg; theme: any; onCopy: () => void; onShare: () => void; onEdit?: () => void; onLongPress?: () => void; showActions?: boolean; onOpenDetail?: (m: Msg) => void }) {
  const user = msg.role === "user";
  const align: "flex-end" | "flex-start" = user ? "flex-end" : "flex-start";
  // Kimi: юзер — синяя капсула справа; ассистент — БЕЗ рамки, чистый текст слева
  const containerStyle = { alignSelf: align, maxWidth: (user ? "86%" : "100%") as "86%" | "100%", marginBottom: 10 };
  // Карточка инструмента — до контента, слева (как у Kimi).
  if (msg.tool) {
    return (
      <View style={containerStyle}>
        <ToolCard tool={msg.tool} state={msg.toolState ?? "loading"} output={msg.toolOutput} theme={theme} onOpen={() => onOpenDetail?.(msg)} />
      </View>
    );
  }
  if (msg.streaming) {
    return (
      <View style={containerStyle}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
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
        <View style={{ padding: 14, borderRadius: 20, borderWidth: 1, borderColor: theme.danger, backgroundColor: theme.surface }}>
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
      {user ? (
        // юзер: синяя капсула (KMBlue), белый текст, радиус 20
        <View style={{ backgroundColor: theme.userBubble, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }}>
          {msg.image ? (
            <Image source={{ uri: msg.image }} style={{ width: 200, height: 200, borderRadius: 14, marginBottom: 6 }} resizeMode="cover" />
          ) : null}
          {msg.file ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <MaterialIcons name="insert-drive-file" size={16} color="rgba(255,255,255,.9)" />
              <Text numberOfLines={1} style={{ color: theme.userText, fontSize: 12, flexShrink: 1 }}>{msg.file.name}</Text>
            </View>
          ) : null}
          {msg.content ? (
            <Text style={{ color: theme.userText, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
          ) : null}
        </View>
      ) : (
        // ассистент: БЕЗ рамки и фона — как в Kimi, markdown прямо на фоне чата
        <View>
          {msg.thinking ? (
            <ThinkingBlock
              text={msg.thinking}
              status={msg.streaming ? "thinking" : "done"}
              theme={theme}
              onOpen={() => onOpenDetail?.(msg)}
            />
          ) : null}
          {renderMarkdown(msg.content, theme)}
        </View>
      )}
      </Pressable>
      {/* действия: ТОЛЬКО в самом конце цепочки агента (или у юзера) — голые иконки, без коробок */}
            {showActions && !msg.streaming && (
              <View style={{ flexDirection: "row", justifyContent: user ? "flex-end" : "flex-start", marginTop: 8, gap: 2 }}>
                <Pressable onPress={onCopy} hitSlop={10} accessibilityLabel="Копировать" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="content-copy" size={17} color={theme.dim} />
                </Pressable>
                <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="Поделиться" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="share" size={17} color={theme.dim} />
                </Pressable>
                {/* «Изменить» — только иконка, без текста (значок сам объясняет) */}
                {user && onEdit && (
                  <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Изменить сообщение" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                    <MaterialIcons name="edit" size={17} color={theme.dim} />
                  </Pressable>
                )}
              </View>
            )}
    </View>
  );
}

/* ── Пустой экран: только приветственный текст (сверху, не по центру) ── */
function EmptyChat({ theme, topInset }: { theme: any; topInset?: number }) {
  return (
    <View style={{ flex: 1, paddingTop: (topInset ?? 0) + 66, paddingHorizontal: 22 }}>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontFamily: fonts.mono, lineHeight: 31 }}>
        Привет!{"\n"}Чем займёмся сегодня?
      </Text>
      <Text style={{ color: theme.dim, fontSize: 13.5, marginTop: 12, lineHeight: 21 }}>
        Спроси что угодно — помогу с кодом, проектами и задачами.
      </Text>
    </View>
  );
}
