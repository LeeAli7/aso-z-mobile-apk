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
  Keyboard,
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
import { ModelInfo, streamChat, streamAgentChat, ChatMessage, ChatPart, AgentToolCall } from "../core/gateway";
import { buildAttachmentParts } from "../core/attachments";
import { getToolDefs } from "../core/tools";
import { dueJobs, markJobRun } from "../core/cron";
import { runSelfReview } from "../core/selfImprove";
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
import { parseCmdBlocks, runCommandCapture, runtimeAvailable } from "../core/runtime";
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
  // Стриминг — per-session: каждая сессия отвечает независимо, переключение
  // на другую сессию не блокирует и не рвёт текущий ответ.
  const [streamingSessions, setStreamingSessions] = useState<Record<string, boolean>>({});
  const streamingRef = useRef<Record<string, boolean>>({});
  // Стоп/abort — тоже per-session (кнопка «Стоп» останавливает только активную).
  const runStateRef = useRef<Record<string, { stop: boolean; ctrl: AbortController | null }>>({});
  const getRun = (sid: string) => {
    if (!runStateRef.current[sid]) runStateRef.current[sid] = { stop: false, ctrl: null };
    return runStateRef.current[sid];
  };
  const isStreaming = (sid?: string | null) => (sid ? !!streamingRef.current[sid] : false);
  const markStreaming = (sid: string, on: boolean) => {
    streamingRef.current[sid] = on;
    setStreamingSessions((p) => ({ ...p, [sid]: on }));
  };
  const [msgMenuTarget, setMsgMenuTarget] = useState<Msg | null>(null);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [editTarget, setEditTarget] = useState<Msg | null>(null);
  const [editValue, setEditValue] = useState("");
  // детали команды/раздумий — bottom-sheet как окно сессии
  const [detailTarget, setDetailTarget] = useState<Msg | null>(null);
  // прикрепление: окно-меню (фото/камера/файл) и выбранные вложения
  const [attachOpen, setAttachOpen] = useState(false);
  // ── Мультивложение (t9): массив выбранных файлов/фото ──
  const [attachments, setAttachments] = useState<{ kind: "image" | "camera" | "file"; uri: string; name?: string }[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);

  // ── Клавиатура (t4/t11): на Android капсула ввода должна подниматься над клавиатурой.
  // Манифест имеет adjustResize, но при плавающей капсуле/edge-to-edge он не срабатывает —
  // слушаем Keyboard и добавляем отступ снизу вручную. Это же убирает «чёрную полосу»
  // под капсулой: капсула висит над навигационной панелью, а не на ней.
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sh = Keyboard.addListener("keyboardDidShow", (e) => setKbH(e.endCoordinates.height));
    const hd = Keyboard.addListener("keyboardDidHide", () => setKbH(0));
    return () => { sh.remove(); hd.remove(); };
  }, []);
  // ── окно хранилища (проекты + файлы + инструкции, как у Hermes) ──
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
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

  // ── Прикрепление: фото (галерея, мультивыбор), камера, файл (мультивыбор) ──
  const pickImage = useCallback(async () => {
    setAttachOpen(false);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 10,
      });
      if (!res.canceled && res.assets?.length) {
        const items = res.assets.map((a) => ({ kind: "image" as const, uri: a.uri, name: a.fileName ?? "photo" }));
        setAttachments((prev) => [...prev, ...items]);
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
        setAttachments((prev) => [...prev, { kind: "camera", uri: res.assets![0].uri, name: res.assets![0].fileName ?? "photo" }]);
      }
    } catch (e: any) {
      showToast("err", `Не удалось открыть камеру: ${e?.message || "ошибка"}`);
    }
  }, []);

  const pickFile = useCallback(async () => {
    setAttachOpen(false);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (!res.canceled && res.assets?.length) {
        const items = res.assets.map((a) => ({ kind: "file" as const, uri: a.uri, name: a.name ?? "файл" }));
        setAttachments((prev) => [...prev, ...items]);
      }
    } catch (e: any) {
      showToast("err", `Не удалось выбрать файл: ${e?.message || "ошибка"}`);
    }
  }, []);

  // ── Slash-команды (P2.4): /new /help /cmd /mem /todo /skills /cron /search ──
  const runSlashCommand = useCallback(
    async (raw: string): Promise<string | null> => {
      const [cmd] = raw.split(/\s+/);
      const rest = raw.slice(cmd.length).trim();
      switch (cmd) {
        case "/new": {
          const sid = newSession();
          setActive(sid);
          return "Новая сессия создана.";
        }
        case "/help":
          return [
            "Команды:",
            "/new — новая сессия",
            "/help — эта справка",
            "/model — сменить модель (настройки)",
            "/cmd <команда> — выполнить в терминале",
            "/mem — показать память агента",
            "/mem clear — очистить память",
            "/todo — показать задачи",
            "/todo + <текст> — добавить задачу",
            "/skills — список навыков",
            "/cron — показать автозадачи",
            "/search <запрос> — поиск в интернете",
          ].join("\n");
        case "/cmd": {
          if (!rest) return "Формат: /cmd <команда>";
          const { runCommandCapture, runtimeAvailable } = await import("../core/runtime");
          if (!runtimeAvailable()) return "Терминал доступен только на Android.";
          const r = await runCommandCapture(rest);
          return r.ok
            ? `$ ${rest}\n${(r.output || "(пусто)").slice(0, 3000)}`
            : `$ ${rest}\nОшибка: ${r.output?.trim() || r.error || `exit ${r.code}`}`;
        }
        case "/mem": {
          const { memorySnapshot, clearMemory } = await import("../core/memory");
          if (rest === "clear") {
            await clearMemory();
            return "Память очищена.";
          }
          const snap = await memorySnapshot();
          return snap || "Память пуста.";
        }
        case "/todo": {
          const { runTodoOps } = await import("../core/todo");
          if (rest.startsWith("+")) {
            return runTodoOps([{ action: "add", content: rest.slice(1).trim() }]);
          }
          return runTodoOps([{ action: "list" }]);
        }
        case "/skills": {
          const { listSkills } = await import("../core/skills");
          const list = await listSkills();
          return list.length
            ? "Навыки:\n" + list.map((s) => `- ${s.name}: ${s.description}`).join("\n")
            : "Навыков нет.";
        }
        case "/cron": {
          const { loadJobs, upcoming } = await import("../core/cron");
          const jobs = await loadJobs();
          if (!jobs.length) return "Автозадач нет.";
          const up = await upcoming(jobs);
          return "Автозадачи:\n" + jobs.map((j) => `- ${j.name} [${j.enabled ? "вкл" : "выкл"}] ${j.schedule}\n  ${j.prompt.slice(0, 80)}`).join("\n") + "\n\n" + up.join("\n");
        }
        case "/search": {
          if (!rest) return "Формат: /search <запрос>";
          const { webSearch, formatSearchResults } = await import("../core/webSearch");
          const r = await webSearch(rest);
          return r.ok ? formatSearchResults(r.results) : `Поиск не удался: ${r.error}`;
        }
        default:
          return null; // не команда
      }
    },
    [newSession, setActive],
  );

  const sendText = useCallback(
    async (raw: string) => {
      const content = raw.trim();
      if (!content || isStreaming(active?.id) || !model) return;

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

      // ── Slash-команды (P2.4): /new /help /cmd /mem /todo /skills /cron /search ──
      if (content.startsWith("/")) {
        const reply = await runSlashCommand(content);
        if (reply !== null) {
          dispatch({
            type: "ADD_MSG", sessionId: sid,
            msg: { id: genId(), role: "user", content },
          });
          dispatch({
            type: "ADD_MSG", sessionId: sid,
            msg: { id: genId(), role: "assistant", content: reply },
          });
          setAttachments([]);
          setText("");
          scrollBottom();
          return;
        }
      }

      dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: genId(), role: "user", content, ...(attachments.length ? { attachments: [...attachments] } : {}) } });
      setAttachments([]);
      setText("");
      markStreaming(sid, true);
      getRun(sid).stop = false;
      scrollBottom();

      const cur = state.sessions.find((s) => s.id === sid);
      // ВАЖНО: включаем текущее сообщение в историю — иначе модель не видит вопрос.
      // Вложения (фото/файл) превращаются в части сообщения (vision/текст).
      const buildHistoryMsg = async (m: Msg | null, extraParts: ChatPart[], overrideText?: string): Promise<ChatMessage> => {
        const parts: ChatPart[] = [];
        const content = (overrideText ?? m?.content ?? "").trim();
        if (content) parts.push({ type: "text", text: content });
        // мультивложение: все прикреплённые файлы/фото (новый формат)
        if (m?.attachments?.length) {
          for (const a of m.attachments) {
            const p = await buildAttachmentParts(a.kind === "file" ? "file" : "image", a.uri, a.name).catch(() => [] as ChatPart[]);
            parts.push(...p);
          }
        } else {
          // старый формат: одиночное вложение
          if (m?.image) {
            const p = await buildAttachmentParts("image", m.image, m.file?.name).catch(() => [] as ChatPart[]);
            parts.push(...p);
          } else if (m?.file) {
            const p = await buildAttachmentParts("file", m.file.uri, m.file.name).catch(() => [] as ChatPart[]);
            parts.push(...p);
          }
        }
        parts.push(...extraParts);
        return { role: m?.role === "assistant" ? "assistant" : "user", content: parts.length ? parts : content };
      };

      // Текущие вложения (ещё не сохранены в Msg) — строим parts.
      let attachParts: ChatPart[] = [];
      for (const a of attachments) {
        const p = await buildAttachmentParts(a.kind === "file" ? "file" : "image", a.uri, a.name).catch(() => [] as ChatPart[]);
        attachParts.push(...p);
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

      // ── Память агента: факты о пользователе + заметки (как Hermes memory-плагин) ──
      // По роадмапу Hermes: память инжектится в USER-сообщение (не system) —
      // чтобы не гасить prefix-cache системного промпта и не путать модель.
      try {
        const { memorySnapshot } = await import("../core/memory");
        const snap = await memorySnapshot();
        if (snap) {
          const firstUser = chatMessages.findIndex((m) => m.role === "user");
          if (firstUser >= 0) {
            const target = chatMessages[firstUser];
            const prevContent =
              typeof target.content === "string"
                ? target.content
                : (target.content as any[])?.map((p: any) => p.text || "").join(" ") || "";
            chatMessages[firstUser] = {
              ...target,
              content: `${snap}\n\n---\n${prevContent}`,
            };
          }
        }
      } catch {}

      let acc = "";
      let textAcc = "";
      let thinkId: string | null = null;
      let textId: string | null = null;
      const toolIds: string[] = [];
      let toolIdx = 0;
      const written: string[] = [];
      const usedTools = new Set<string>();
      let hadToolError = false;
      const ctrl = new AbortController();
      getRun(sid).ctrl = ctrl;

      const closeMsg = (id: string | null, patch: Record<string, unknown> = {}) => {
        if (id) dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: id, patch: { streaming: false, ...patch } });
      };

      // Токены текста: создаём своё сообщение при первом токене; после тула
      // сообщение закрывается и следующий текст (итог) уходит в НОВОЕ сообщение —
      // поэтому текст агента всегда остаётся на своём месте в цепочке.
      const onToken = (tok: string) => {
        if (getRun(sid).stop) return;
        acc += tok;
        textAcc += tok;
        if (!textId) {
          textId = genId();
          dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: textId, role: "assistant", content: textAcc, streaming: true } });
        } else {
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: textId, patch: { content: textAcc } });
        }
        scrollBottom();
        // fallback (plain-путь): агент написал [FILE:]/[CMD:] текстом — карточка как в Kimi
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
        const cm = acc.match(/\[CMD:\s*([^\n\]]+)\]/);
        if (cm && !written.includes("__showed_cmd_" + cm[1])) {
          written.push("__showed_cmd_" + cm[1]);
          dispatch({
            type: "ADD_MSG",
            sessionId: sid,
            msg: { id: genId(), role: "assistant", content: "", tool: "выполняю " + cm[1].trim() },
          });
        }
      };
      // Раздумья: отдельное сообщение (своя карточка в блоке цепочки).
      // streaming=true только ПОКА модель думает; при старте команды гаснет.
      // Если думалка пришла ПОСЛЕ начала текста (plain-путь, без тулов) — приклеиваем
      // её к текстовому сообщению: она рендерится НАД ответом, а не отдельным блоком снизу.
      const onThinking = (thinking: string) => {
        if (getRun(sid).stop) return;
        const plainNoTools = toolIds.length === 0;
        if (plainNoTools && !thinkId && textId) {
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: textId, patch: { thinking, streaming: true } });
          return;
        }
        if (!thinkId) {
          thinkId = genId();
          dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: thinkId, role: "assistant", content: "", thinking, streaming: true } });
        } else {
          dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: thinkId, patch: { thinking, streaming: true } });
        }
      };
      // Тул начат: закрываем текущий текст (он остаётся в цепочке на своём месте),
      // думалка гаснет (анимации — только у активного шага), создаём карточку тула с пульсацией.
      const onToolCall = (call: AgentToolCall) => {
        if (getRun(sid).stop) return;
        usedTools.add(call.name);
        let label = "выполняю " + call.name;
        try {
          const a = JSON.parse(call.arguments || "{}");
          if (a.command) label += " " + String(a.command);
        } catch {}
        if (thinkId) { closeMsg(thinkId); thinkId = null; } // думалка закрыта — следующая будет НОВЫМ блоком (t6)
        if (textId) { closeMsg(textId); textId = null; textAcc = ""; }
        const tid = genId();
        toolIds.push(tid);
        dispatch({
          type: "ADD_MSG",
          sessionId: sid,
          msg: { id: tid, role: "assistant", content: "", tool: label, toolState: "loading" },
        });
      };
      // Тул завершён: гасим пульсацию, показываем результат.
      const onToolResult = (_call: AgentToolCall, ok: boolean, result: string) => {
        if (getRun(sid).stop) return;
        const tid = toolIds[toolIdx++];
        if (!tid) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: tid,
          patch: { toolState: ok ? "done" : "error", toolOutput: String(result ?? "").slice(0, 2000) },
        });
      };
      // Финал: FILE-запись (проекты, plain-путь), [CMD:] фолбэк, закрытие стриминга.
      const finalize = async (clean: string) => {
        markStreaming(sid, false);
        if (getRun(sid).stop && !clean) return; // отменено пользователем — не трогаем
        let finalText = clean || acc || (getRun(sid).stop ? "" : "(пусто)");
        if (proj && toolIds.length === 0) {
          const blocks = parseFileBlocks(finalText || acc);
          for (const b of blocks) {
            try {
              await writeFile(proj.id, b.path, b.content);
            } catch (e: any) {
              closeMsg(thinkId);
              if (textId) {
                dispatch({
                  type: "UPDATE_MSG", sessionId: sid, msgId: textId,
                  patch: { streaming: false, error: `не удалось записать ${b.path}: ${e?.message || e}`, content: textAcc || "" },
                });
              }
              return;
            }
          }
          finalText = (finalText || acc).replace(/\[FILE:[^\]]+\]\s*```[^\n]*\n[\s\S]*?```/g, "").trim() || acc;
        }
        if (toolIds.length === 0) {
          const cmds = parseCmdBlocks(finalText || acc);
          const cmdReports: string[] = [];
          for (const cmd of cmds) {
            if (!runtimeAvailable()) {
              cmdReports.push(`$ ${cmd}\nрантайм доступен только на Android`);
              continue;
            }
            const r = await runCommandCapture(cmd, proj?.id);
            const detail = !r.ok && r.output?.trim()
              ? r.output.trim().split("\n").slice(-3).join("\n").slice(-500)
              : r.output?.trim() || r.error || "не удалось выполнить";
            cmdReports.push(`$ ${cmd}\n${detail}`);
          }
          finalText = (finalText || acc).replace(/\[CMD:[^\]]+\]\s*/g, "").trim() || acc;
          if (cmdReports.length) {
            finalText = (finalText ? finalText + "\n\n" : "") + cmdReports.join("\n\n");
          }
        }
        closeMsg(thinkId);
        thinkId = null;
        if (textId) {
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: textId,
            patch: { content: finalText || textAcc || "", streaming: false },
          });
          textId = null;
        }
      };
      const onError = (err: string) => {
        markStreaming(sid, false);
        if (getRun(sid).stop) return; // abort по Стоп — не показываем ошибку
        closeMsg(thinkId);
        if (textId) {
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: textId,
            patch: { streaming: false, error: err, content: textAcc || "" },
          });
        } else {
          dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: genId(), role: "assistant", content: "", error: err } });
        }
      };

      // ── Путь А (Android): настоящий function calling — модель вызывает run_command,
      // результат возвращается модели, цикл до финального ответа.
      // ── Путь Б (web/dev или провайдер без tools): обычный стрим + текстовые [CMD:].
      const toolDefs = getToolDefs();
      if (runtimeAvailable() && toolDefs.length > 0) {
        await streamAgentChat(
          model,
          chatMessages,
          toolDefs,
          {
            onToken,
            onThinking,
            onToolCall,
            onToolResult,
            onDone: (finalText) => {
              void finalize(finalText);
              // ── Self-improve (P1.3): после сложного хода (2+ тула) тихо анализируем ──
              if (!getRun(sid).stop && usedTools.size >= 2 && !hadToolError) {
                void runSelfReview(model, {
                  toolCalls: usedTools.size,
                  toolNames: [...usedTools],
                  summary: (acc || finalText || "").slice(0, 1500),
                  hadErrors: hadToolError,
                });
              }
            },
            onError,
          },
          ctrl.signal,
          { projectId: proj?.id, onToolProgress: (msg) => { if (!getRun(sid).stop) setToolNote(msg); } },
        );
      } else {
        await streamChat(model, chatMessages, {
          onToken,
          onThinking,
          onDone: (clean) => { void finalize(clean || acc); },
          onError,
        }, ctrl.signal);
      }
    },
    [text, active, dispatch, model, setActive, scrollBottom, attachments, runSlashCommand, streamingSessions],
  );

  // ── Cron-раннер автозадач (P2.2) ──
  // Тикает каждые 30с; выполнение = агентский ход в чат (если приложение открыто).
  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      if (disposed || !model) return;
      try {
        const jobs = await dueJobs();
        for (const job of jobs) {
          if (disposed || !model) break;
          // префикс: модель понимает, что это автозадача, и отвечает кратко
          const prompt = `[Автозадача: ${job.name}]\n${job.prompt}\n\nВыполни и дай краткий отчёт.`;
          void sendText(prompt).then(() => {
            void markJobRun(job.id, "выполнена").catch(() => {});
          });
        }
      } catch {
        // тик не должен ронять UI
      }
    };
    const iv = setInterval(() => void tick(), 30_000);
    // первый тик с небольшой задержкой (приложение только открылось)
    const first = setTimeout(() => void tick(), 10_000);
    return () => {
      disposed = true;
      clearInterval(iv);
      clearTimeout(first);
    };
  }, [model, sendText]);

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
    markStreaming(sid, true);
    getRun(sid).stop = false;

    // история: все до вопроса включительно, с отредактированным текстом.
    // Вложения (image/file) сохраняются как части сообщения.
    const buildMsg = async (m: Msg, j: number): Promise<ChatMessage> => {
      const parts: ChatPart[] = [];
      const text = (j === idx ? newText : m.content).trim();
      if (text) parts.push({ type: "text", text });
      if (m.attachments?.length) {
        for (const a of m.attachments) {
          const p = await buildAttachmentParts(a.kind === "file" ? "file" : "image", a.uri, a.name).catch(() => [] as ChatPart[]);
          parts.push(...p);
        }
      } else {
        if (m.image) {
          const p = await buildAttachmentParts("image", m.image, m.file?.name).catch(() => [] as ChatPart[]);
          parts.push(...p);
        } else if (m.file) {
          const p = await buildAttachmentParts("file", m.file.uri, m.file.name).catch(() => [] as ChatPart[]);
          parts.push(...p);
        }
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
    getRun(sid).ctrl = ctrl;
    await streamChat(model, history, {
      onToken: (tok) => {
        if (getRun(sid).stop) return;
        acc += tok;
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
        scrollBottom();
      },
      onThinking: (thinking) => {
        if (getRun(sid).stop) return;
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { thinking } });
      },
      onDone: (clean) => {
        markStreaming(sid, false);
        if (getRun(sid).stop && !clean) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { content: clean || acc || (getRun(sid).stop ? "" : "(пусто)"), streaming: false },
        });
      },
      onError: (err) => {
        markStreaming(sid, false);
        if (getRun(sid).stop) return;
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

  // Цепочки: подряд идущие assistant-сообщения, начатые думалкой/командой —
  // накапливаются в ОДНОМ стеклянном блоке (как в QIWI). Финальный ответ агента
  // (последнее сообщение цепочки с content) выносится ИЗ капсулы и рендерится
  // обычным сообщением — «за капсулой» (требование пользователя).
  const chainGroups = useMemo(() => {
    const groups: Group[] = [];
    const msgs = active?.messages ?? [];
    let chain: Msg[] = [];
    let chainOpen = false;
    const flush = () => {
      if (chain.length) {
        const last = chain[chain.length - 1];
        const body = chain.slice(0, -1);
        // финальный ответ (content, не команда) — вне капсулы.
        // thinking здесь может быть приклеенной думалкой plain-пути — она рендерится
        // над текстом в обычном Bubble, а не в стеклянном блоке.
        if (last.content && !last.tool) {
          if (body.length) groups.push({ id: "chain-" + chain[0].id, kind: "chain", msgs: body });
          groups.push({ id: last.id, kind: "single", msg: last });
        } else {
          groups.push({ id: "chain-" + chain[0].id, kind: "chain", msgs: chain });
        }
        chain = [];
      }
      chainOpen = false;
    };
    for (const m of msgs) {
      if (m.role === "assistant" && !m.error) {
        // думалка/команда/текст открывает цепочку, дальше тянем ВСЁ подряд
        if (chainOpen || m.thinking || m.tool || m.content) {
          chain.push(m);
          chainOpen = true;
        } else {
          groups.push({ id: m.id, kind: "single", msg: m });
        }
      } else {
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
              // ВАЖНО: хронологический порядок сообщений как есть — думалка → команда →
              // думалка → команда (никакой перегруппировки: всё должно быть на своих местах)
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
                          {/* итог агента — В ТОМ ЖЕ блоке (раздумья/команды + ответ не разваливаются) */}
                          {m.content ? (
                            <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
                              {renderMarkdown(m.content, theme)}
                            </View>
                          ) : null}
                          {/* действия для итога: копировать / поделиться */}
                          {last && m.content && !m.streaming && (
                            <View style={{ flexDirection: "row", justifyContent: "flex-start", paddingHorizontal: 12, paddingTop: 4, gap: 2 }}>
                              <Pressable onPress={() => copyMsg(m)} hitSlop={10} accessibilityLabel="Копировать" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                                <MaterialIcons name="content-copy" size={17} color={theme.dim} />
                              </Pressable>
                              <Pressable onPress={() => shareMsg(m)} hitSlop={10} accessibilityLabel="Поделиться" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                                <MaterialIcons name="share" size={17} color={theme.dim} />
                              </Pressable>
                            </View>
                          )}
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

      {/* streaming-индикатор намеренно убран: ни «обрабатываю запрос…», ни точек —
          пользователь попросил чистый чат. Раздумья видны в блоке ThinkingBlock. */}

      {/* input.
        Android: капсулу поднимаем вручную через kbH (Keyboard listeners выше) —
        манифестный adjustResize не двигает плавающую капсулу при edge-to-edge.
        iOS: KAV с behavior="padding" сдвигает панель. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: Platform.OS === "android" ? kbH + insets.bottom + 8 : insets.bottom + 8 }}>
          {/* вложения — НАД капсулой: иконка ТИПА каждого вложения (та же, что в меню «Прикрепить»), крестики для удаления */}
          {attachments.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8, gap: 8 }}>
              {attachments.map((a, ai) => (
                <View key={ai} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 18, paddingLeft: 6, paddingRight: 4, paddingVertical: 4 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.accentDim }}>
                    {a.kind === "file" ? (
                      <MaterialIcons name={fileIconName(a.name)} size={15} color={theme.accentHi} />
                    ) : (
                      <MaterialIcons name={a.kind === "camera" ? "photo-camera" : "photo-library"} size={15} color={theme.accentHi} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, maxWidth: 110, flexShrink: 1 }}>{a.name ?? "файл"}</Text>
                  <Pressable onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== ai))} hitSlop={8} accessibilityLabel="Убрать вложение" style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }}>
                    <MaterialIcons name="close" size={14} color={theme.mute} />
                  </Pressable>
                </View>
              ))}
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
            {isStreaming(active?.id) ? (
              <Pressable
                onPress={() => {
                  const s = active?.id;
                  if (!s) return;
                  getRun(s).stop = true;
                  getRun(s).ctrl?.abort();
                  markStreaming(s, false);
                }}
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
      <Sheet visible={!!detailTarget} onClose={() => setDetailTarget(null)} title={detailTarget?.tool ? "Ход выполнения" : "Думаю"} snapPoints={["auto"]} autoMaxPct={60}>
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
      <Sheet visible={!!editTarget} onClose={() => setEditTarget(null)} title="Изменить сообщение" snapPoints={["auto"]} autoMaxPct={92}>
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
                <Button title="Отправить" onPress={confirmEdit} disabled={!editValue.trim() || isStreaming(active?.id)} fullWidth />
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
              blur={false}
              accessibilityLabel={b.label}
              style={{
                flex: 1,
                aspectRatio: 1,
                // фон/тень не должны вылезать за скруглённую рамку кнопки
                shadowOpacity: 0,
                elevation: 0,
                borderTopWidth: 0,
                overflow: "hidden",
              }}
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

/**
 * Иконка файла по типу — те же MaterialIcons, что в меню «Прикрепить»:
 * архив → archive, документ/текст → description, остальное → insert-drive-file.
 */
function fileIconName(name?: string): "archive" | "description" | "insert-drive-file" {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst"].includes(ext)) return "archive";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "ods", "odp", "csv"].includes(ext)) return "description";
  return "insert-drive-file";
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
  // Стриминг: НИКАКИХ точек-заглушек и скрытия контента — текст рендерится
  // по мере поступления токенов (раньше `streaming` прятал контент до конца —
  // пользователь видел «нет стриминга»: всё появлялось разом).
  if (msg.streaming && !msg.content && !msg.thinking && !msg.tool) {
    return null;
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
          {(() => {
            // все вложения: новый формат (attachments) или старый (image/file)
            const fallback: { kind: "image" | "file"; uri: string; name?: string }[] =
              msg.image || msg.file
                ? [{ kind: msg.image ? "image" : "file", uri: msg.image ?? msg.file!.uri, name: msg.file?.name }]
                : [];
            const list: { kind: "image" | "camera" | "file"; uri: string; name?: string }[] =
              msg.attachments?.length ? msg.attachments : fallback;
            if (!list.length) return null;
            return (
              <View>
                {list.map((a, i) =>
                  a.kind === "file" ? (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <MaterialIcons name={fileIconName(a.name)} size={16} color="rgba(255,255,255,.9)" />
                      <Text numberOfLines={1} style={{ color: theme.userText, fontSize: 12, flexShrink: 1 }}>{a.name}</Text>
                    </View>
                  ) : (
                    <Image key={i} source={{ uri: a.uri }} style={{ width: 200, height: 200, borderRadius: 14, marginBottom: 6 }} resizeMode="cover" />
                  ),
                )}
              </View>
            );
          })()}
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
