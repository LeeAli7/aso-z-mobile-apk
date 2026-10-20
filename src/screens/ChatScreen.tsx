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
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { AppIcon, AppIconName } from "../design-system/components/AppIcon";

import { useApp, genId, Msg, Session } from "../store/AppStore";
import { ModelInfo, streamChat, streamAgentChat, ChatMessage, ChatPart, AgentToolCall } from "../core/gateway";
import { buildAttachmentParts } from "../core/attachments";
import { getToolDefsGated } from "../core/tools";
import { registerBg, unregisterBg } from "../core/background";
import { claimDueJobs, setJobResult } from "../core/cron";
import { runSelfReview } from "../core/selfImprove";
import { DrawerLineArt } from "../components/DrawerLineArt";
import { BgTasksSheet, BgIndicator, BgTask } from "../components/BgTasksSheet";
import { renderMarkdown } from "../components/Markdown";
import { ThinkingBlock } from "../components/kimi/ThinkingBlock";
import { ToolCard } from "../components/kimi/ToolCard";
import { fonts } from "../theme/tokens";
import {
  VibeProject,
  listProjects,
  treeFiles,
  listFiles,
  parseFileBlocks,
  writeFile,
} from "../core/vibeLocal";
import { openInTermux, openFolderInFileManager, projectDirPath } from "../core/termux";
import { parseCmdBlocks, runCommandCapture, runtimeAvailable } from "../core/runtime";
import { IconButton } from "../design-system/components/IconButton";
import { touchTarget } from "../design-system/tokens";
import { Glass, GlassPressable } from "../design-system/components/Glass";
import { Sheet } from "../design-system/components/Sheet";
import { Button } from "../design-system/components/Button";
import { Input } from "../design-system/components/Input";
import { showToast } from "../design-system/components/Toast";

/** Группа сообщений для ленты: chain = блок раздумий+команд, single = обычное сообщение. */
type Group =
  | { id: string; kind: "chain"; msgs: Msg[] }
  | { id: string; kind: "single"; msg: Msg };

export function ChatScreen({ navigation }: { navigation: any }) {
  const { state, theme, dispatch, t, newSession, setActive, deleteSession, setDefaultModel } = useApp();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    // шторка фоновых: стрим активной сессии — тоже фоновая задача
    setBgTasks((p) => {
      const rest = p.filter((x) => x.id !== "stream:" + sid);
      if (on) return [...rest, { id: "stream:" + sid, kind: "stream", title: "Ответ агента" } as BgTask];
      return rest;
    });
    // единый реестр фоновых: индикатор и кнопка «стоп» видят стрим из движка
    if (on) {
      registerBg("stream", "stream:" + sid, "Ответ агента", () => {
        const r = runStateRef.current[sid];
        if (r) {
          r.stop = true;
          try { r.ctrl?.abort(); } catch {}
        }
      });
    } else {
      unregisterBg("stream:" + sid);
    }
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
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
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
  // шторка фоновых процессов (рантайм/cron/делегация) — открывается только при наличии запущенных
  const [bgOpen, setBgOpen] = useState(false);
  const [bgTasks, setBgTasks] = useState<BgTask[]>([]);
  const [bgCount, setBgCount] = useState(0);

  // Индикатор фоновых задач: раньше считал только стримы чата,
  // а runtime/cron делегирование из реестра не попадали в цифру.
  useEffect(() => {
    let alive = true;
    const upd = async () => {
      try {
        const { listRunning } = await import("../core/background");
        const reg = await listRunning();
        if (alive) setBgCount(bgTasks.length + reg.filter((t) => t.kind !== "stream").length);
      } catch {
        if (alive) setBgCount(bgTasks.length);
      }
    };
    void upd();
    const iv = setInterval(upd, 4000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [bgTasks.length]);
  // ── Голосовой ввод (expo-speech-recognition: Android SpeechRecognizer / iOS / web).
  // Транскрипт дописывается в поле, отправки без проверки нет.
  const [recording, setRecording] = useState(false);
  const recStarting = useRef(false);
  // Текст, который был в поле до старта записи. Android присылает interim-результат
  // ЦЕЛИКОМ на каждое обновление; дописывание «prev + txt» давало слова по 2-3 раза.
  const sttBase = useRef("");
  // true ровно на время программной записи текста из STT: ручной ввод пользователя
  // в это окно не должен считаться частью распознанной фразы.
  const sttWriting = useRef(false);
  useSpeechRecognitionEvent("result", (e: any) => {
    const txt = String(e?.results?.[0]?.transcript ?? "").trim();
    if (!txt) return;
    const base = sttBase.current.trim();
    const merged = base ? base + " " + txt : txt;
    sttWriting.current = true;
    setText(merged);
    // сбрасываем флаг на следующем тике: onChangeText от пользователя уже после
    setTimeout(() => { sttWriting.current = false; }, 0);
    // base НЕ фиксируем на isFinal: Android присылает кумулятивный транскрипт,
    // и «промежуточный финал + финал» давал проговорённые слова по 2-3 раза.
  });
  useSpeechRecognitionEvent("error", () => {
    recStarting.current = false;
    setRecording(false);
  });
  useSpeechRecognitionEvent("end", () => {
    recStarting.current = false;
    setRecording(false);
  });
  const toggleVoice = useCallback(async () => {
    try {
      if (recording) {
        try { ExpoSpeechRecognitionModule.stop(); } catch {}
        setRecording(false);
        return;
      }
      if (recStarting.current) return;
      // кнопка микрофона подчиняется настройке «Голосовой ввод»
      const { loadVoiceConfig } = await import("../core/voice");
      const voice = await loadVoiceConfig().catch(() => null);
      if (voice && !voice.sttEnabled) {
        showToast("err", "Голосовой ввод выключен в настройках");
        return;
      }
      recStarting.current = true;
      try {
        const perm: any = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null);
        const granted = perm == null ? true : (perm.granted ?? perm.status === "granted");
        if (!granted) {
          showToast("err", "Нет доступа к микрофону");
          recStarting.current = false;
          return;
        }
      } catch {}
      const lang = state.lang === "en" ? "en-US" : "ru-RU";
      try {
        sttBase.current = text.trim();
        ExpoSpeechRecognitionModule.start({ lang, interimResults: true, continuous: false } as any);
        setRecording(true);
      } catch (e: any) {
        showToast("err", String(e?.message || e));
        recStarting.current = false;
      }
    } catch {}
  }, [recording, state.lang, text]);
  const listRef = useRef<FlatList<any>>(null);

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const allModels = [...state.models, ...state.customModels];
  const model = allModels.find((m) => m.modelName === active?.modelId) ?? allModels[0];
  const modelName = model?.displayName ?? "Aso";
  // Активный vibe-проект сессии (контекст агента).
  const activeProject = active?.projectId
    ? projects.find((p) => p.id === active.projectId) ?? null
    : null;

  // Смена модели сессии (панель и команда /model). Объявлена ДО runSlashCommand,
  // иначе команда обращалась бы к ещё не инициализированной переменной.
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
      setDefaultModel(m.modelName);
    },
    [active, dispatch, setActive, setDefaultModel, t],
  );

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

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);


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
            "/model — список моделей",
            "/model <имя> — сменить модель",
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
        case "/model": {
          if (!allModels.length) return "Модели не подключены.";
          if (!rest) {
            const lines = allModels.map((m) => `${m.modelName === model?.modelName ? "• " : "  "}${m.displayName} — ${m.modelName}`);
            return "Модели (• — активная):\n" + lines.join("\n") + "\n\nСменить: /model <имя или часть>";
          }
          const q = rest.toLowerCase();
          const hit =
            allModels.find((m) => m.modelName.toLowerCase() === q) ??
            allModels.find((m) => m.displayName.toLowerCase() === q) ??
            allModels.find((m) => m.modelName.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
          if (!hit) return `Модель «${rest}» не найдена. /model — список.`;
          switchModel(hit);
          return `Модель: ${hit.displayName}`;
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
    [newSession, setActive, allModels, model, switchModel],
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
      // Hermes-style: если есть полная tool-история прошлых ходов — используем ЕЁ
      // (assistant с tool_calls + результаты), а не пересобираем из UI-сообщений,
      // которые теряют структуру вызовов → агент «забывает» выполненные команды.
      const hist = cur?.agentHistory ?? [];
      if (hist.length > 0) {
        prev.push(...hist);
      } else {
        for (const m of (cur?.messages ?? []).filter((x) => !x.streaming && !x.error).slice(-20)) {
          prev.push(await buildHistoryMsg(m, []));
        }
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
        // выключенная память действительно не вшивается в контекст
        const { loadAgentConfig } = await import("../core/agentConfig");
        const cfg = await loadAgentConfig();
        const { memorySnapshot } = await import("../core/memory");
        const snap = cfg.memoryEnabled ? await memorySnapshot() : "";
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
        // Текст, закрытый перед tool-вызовом, уже показан отдельным пузырём —
        // сбрасываем накопление, иначе он дублируется в финальном ответе.
        if (textId) { closeMsg(textId); textId = null; textAcc = ""; }
        acc = "";
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
        if (getRun(sid).stop && !clean) {
          // Отмена пользователем: раньше думалка и пузырь оставались в состоянии
          // стриминга навсегда — «Думаю» крутилось и кнопки не возвращались.
          if (thinkId) { closeMsg(thinkId); thinkId = null; }
          if (textId) {
            dispatch({
              type: "UPDATE_MSG", sessionId: sid, msgId: textId,
              patch: { content: textAcc || acc || "", streaming: false },
            });
            textId = null;
          }
          for (const tid of toolIds) {
            dispatch({
              type: "UPDATE_MSG", sessionId: sid, msgId: tid,
              patch: { toolState: "done", toolOutput: "(остановлено)" },
            });
          }
          return;
        }
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
            const r = await runCommandCapture(cmd, proj?.id, proj ? projectDirPath(proj.id) : undefined);
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
        thinkId = null;
        // висящие карточки инструментов не должны пульсировать после ошибки
        for (const tid of toolIds) {
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: tid,
            patch: { toolState: "error" },
          });
        }
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
      // гейт тулсетов: выключенные в настройках инструменты модель больше не видит
      const toolDefs = await getToolDefsGated();
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
            onDone: (finalText, messages) => {
              void finalize(finalText);
              // ── Сохраняем полную tool-историю хода (как Hermes messages[]):
              // assistant с tool_calls + tool-результаты. При следующем сообщении
              // она пойдёт модели целиком — агент ПОМНИТ выполненные команды.
              // Обрезаем: не тащим системный промпт и гигантские выводы.
              if (Array.isArray(messages) && messages.length > 0) {
                const trimmed = messages
                  .filter((m) => m.role !== "system")
                  .slice(-30)
                  .map((m) => {
                    const c = typeof m.content === "string" ? m.content : "";
                    return c.length > 6000 ? { ...m, content: c.slice(0, 6000) + "\n…(обрезано)" } : m;
                  });
                dispatch({ type: "UPDATE_SESSION", sessionId: sid, patch: { agentHistory: trimmed } });
              }
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
          { projectId: proj?.id, cwd: proj ? projectDirPath(proj.id) : undefined, onToolProgress: (msg) => { if (!getRun(sid).stop) setToolNote(msg); } },
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
    [active, dispatch, model, setActive, scrollBottom, attachments, runSlashCommand, streamingSessions],
  );

  // ── Cron-раннер автозадач (P2.2) ──
  // Тикает каждые 30с; выполнение = агентский ход в чат (если приложение открыто).
  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      if (disposed || !model) return;
      // модель занята стримом — не забираем задачи: иначе они помечаются
      // выполненными, а sendText молча выходит и задача не запускается
      if (active?.id && isStreaming(active.id)) return;
      try {
        // claim помечает задачу выполненной ДО запуска, поэтому следующий тик
        // не запустит её повторно, пока агент ещё думает
        const jobs = await claimDueJobs();
        for (const job of jobs) {
          if (disposed || !model) break;
          // префикс: модель понимает, что это автозадача, и отвечает кратко
          const prompt = `[Автозадача: ${job.name}]\n${job.prompt}\n\nВыполни и дай краткий отчёт.`;
          void sendText(prompt).then(() => {
            void setJobResult(job.id, "выполнена").catch(() => {});
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
  }, [model, sendText, active?.id]);

  const send = useCallback(() => {
    if (text.trim()) sendText(text);
  }, [text, sendText]);

  // Повтор последнего запроса (для ошибок AI-сообщения)
  const retryMsg = useCallback(
    (m: Msg) => {
      if (!active || !m.role) return;
      const messages = active.messages;
      const idx = messages.findIndex((x) => x.id === m.id);
      for (let j = idx - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.role === "user") {
          // Убираем неудачный ответ и всё после вопроса: иначе в историю уходит
          // дубль (старый ответ + новый запрос) и модель путается.
          for (const tail of messages.slice(j + 1)) {
            dispatch({ type: "DELETE_MSG", sessionId: active.id, msgId: tail.id });
          }
          dispatch({ type: "UPDATE_SESSION", sessionId: active.id, patch: { agentHistory: [] } });
          sendText(prev.content);
          return;
        }
      }
    },
    [active, sendText, dispatch],
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
        dispatch({ type: "UPDATE_SESSION", sessionId: active.id, patch: { agentHistory: [] } });
        showToast("ok", "Сообщение удалено");
      }
      setMsgMenuTarget(null);
    },
    [active, dispatch],
  );

  const handleNewSession = useCallback(() => {
    const id = newSession();
    setActive(id);
    setDrawerOpen(false);
    setText("");
  }, [newSession, setActive]);

  const openDrawerSession = useCallback((sid: string) => {
    setActive(sid);
    setDrawerOpen(false);
    setText("");
  }, [setActive]);

  const openDrawerRoute = useCallback((route: string) => {
    setDrawerOpen(false);
    navigation.navigate(route);
  }, [navigation]);

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
    // Пересобранная история не совпадает с сохранённой tool-историей прошлого хода —
    // сбрасываем её, иначе агент получает противоречивый контекст.
    dispatch({ type: "UPDATE_SESSION", sessionId: sid, patch: { agentHistory: [] } });
    setEditTarget(null);
    setEditValue("");
    // без модели нельзя запускать перегенерацию: раньше чат навсегда оставался «печатает»
    if (!model) {
      showToast("err", "Модель не выбрана — выбери её капсулой сверху");
      return;
    }
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
    let chainSeq = 0;
    const flush = () => {
      if (chain.length) {
        // раздумья отдельно (стекло), финал — обычным текстом после, всегда.
        // сообщение с content+thinking делится: думалка остаётся в стекле,
        // текст уходит отдельным Bubble (там думалка — сворачиваемый блок сверху).
        let buf: Msg[] = [];
        const pushBuf = () => {
          if (buf.length) {
            chainSeq += 1;
            groups.push({ id: "chain-" + buf[0].id + "-" + chainSeq, kind: "chain", msgs: buf });
            buf = [];
          }
        };
        for (const m of chain) {
          if (m.content && !m.tool) {
            // Раздумья этого сообщения рисуются внутри Bubble — над текстом.
            // В стекло их НЕ дублируем: раньше выходило два «Думаю» подряд.
            pushBuf();
            groups.push({ id: m.id, kind: "single", msg: m });
          } else {
            buf.push(m);
          }
        }
        pushBuf();
        chain = [];
      }
      chainOpen = false;
    };
    for (const m of msgs) {
      if (m.role === "assistant" && !m.error) {
        // чистый текст — всегда отдельным сообщением, никогда внутрь раздумий.
        // думалка/команда открывает цепочку; текст её закрывает и идёт после.
        if (m.content && !m.thinking && !m.tool) {
          flush();
          groups.push({ id: m.id, kind: "single", msg: m });
        } else if (chainOpen || m.thinking || m.tool) {
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
      {/* шапка-минимум (вариант B): бургер + название + новый чат.
          Модель/конфиг/сессии живут в боковой панели. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}
      >
        <View
          pointerEvents="box-none"
          style={{
            flexDirection: "row", alignItems: "center",
            backgroundColor: theme.bg,
            paddingHorizontal: 10, paddingTop: insets.top + 6, paddingBottom: 6,
          }}
        >
          <IconButton name="menu" size={20} onPress={() => setDrawerOpen(true)} accessibilityLabel={t("sessions")} />
          <View pointerEvents="box-none" style={{ flex: 1 }} />
          <BgIndicator theme={theme} count={bgCount} onPress={() => setBgOpen(true)} />
          {/* Выбор модели — справа, габариты как у бургера: высота touchTarget, капсула. */}
          <Pressable
            onPress={() => setModelPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Модель"
            style={({ pressed }) => ({
              height: touchTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 16,
              borderRadius: touchTarget / 2,
              backgroundColor: pressed ? theme.surface2 : theme.surface,
            })}
          >
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13.5, fontWeight: "600", maxWidth: 150 }}>{modelName}</Text>
            <AppIcon name="chevron-down" size={13} color={theme.dim} />
          </Pressable>
        </View>
      </View>

      {/* шторка фоновых процессов — только когда есть запущенные (рантайм/cron/делегация).
          Состояние стриминга видно по кнопке в капсуле внизу, там же стоп. */}
      <BgTasksSheet
        visible={bgOpen}
        onClose={() => setBgOpen(false)}
        theme={theme}
        t={t}
        tasks={bgTasks}
        onStop={(task) => {
          // стоп фоновой: рантайм-сессия / стрим активной сессии
          if (task.kind === "runtime") {
            const sid = Number(task.id.replace(/^runtime:/, "").replace("rt:", ""));
            if (!Number.isNaN(sid)) {
              try {
                const { killSession } = require("../core/runtime");
                void killSession(sid).catch(() => {});
              } catch {}
            }
            setBgTasks((p) => p.filter((x) => x.id !== task.id));
          } else if (task.kind === "stream") {
            const s = active?.id;
            if (s) {
              getRun(s).stop = true;
              getRun(s).ctrl?.abort();
              markStreaming(s, false);
            }
            setBgTasks((p) => p.filter((x) => x.id !== task.id));
          } else {
            setBgOpen(false);
          }
        }}
        onOpen={(task) => {
          // тап по фоновой задаче — открыть то место, где она живёт
          setBgOpen(false);
          if (task.kind === "stream") {
            const sid = task.id.replace("stream:", "");
            if (sid) setActive(sid);
          } else if (task.kind === "cron") {
            navigation.navigate("AgentSettings");
          } else if (task.kind === "runtime") {
            navigation.navigate("Terminal");
          }
        }}
      />

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
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: g, index }) => {
            if (g.kind === "chain") {
              // единый блок: раздумья + команды накапливаются внутри (как в QIWI)
              const onDetail = (m: Msg) => setDetailTarget(m);
              // ВАЖНО: хронологический порядок сообщений как есть — думалка → команда →
              // думалка → команда (никакой перегруппировки: всё должно быть на своих местах)
              // Один блок «Думаю» на всю цепочку: раньше на каждую реплику
              // выводился свой блок подряд — выглядело как «Думаю, Думаю, Думаю».
              const chainText = g.msgs
                .filter((m) => m.thinking)
                .map((m) => String(m.thinking))
                .join("\n\n");
              const chainTools = g.msgs.filter((m) => m.tool);
              const anyStreaming = g.msgs.some((m) => m.streaming);
              const firstThink = g.msgs.find((m) => m.thinking);
              return (
                <View style={{ width: "94%", alignSelf: "flex-start", marginBottom: 10 }}>
                  <Glass radius={20} blur={false} style={{ overflow: "hidden", width: "100%", paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12 }}>
                    {chainText ? (
                      <ThinkingBlock
                        text={chainText}
                        status={anyStreaming ? "thinking" : "done"}
                        theme={theme}
                        onOpen={() => firstThink && onDetail(firstThink)}
                        bare
                      />
                    ) : null}
                    {chainTools.map((m) => (
                      <ToolCard
                        key={m.id}
                        tool={String(m.tool)}
                        state={m.toolState ?? "loading"}
                        output={m.toolOutput}
                        theme={theme}
                        onOpen={() => onDetail(m)}
                        bare
                      />
                    ))}
                  </Glass>
                </View>
              );
            }
            const msg = g.msg;
            // Действия — только у последнего сообщения чата: раньше панель висела
            // под каждой репликой и читалась как часть ответа агента.
            const showActions = index === chainGroups.length - 1 && !msg.tool;
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
        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: Platform.OS === "android" ? kbH + 8 : insets.bottom + 8 }}>
          {/* вложения — НАД капсулой: иконка ТИПА каждого вложения (та же, что в меню «Прикрепить»), крестики для удаления */}
          {attachments.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8, gap: 8 }}>
              {attachments.map((a, ai) => (
                <View key={ai} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 20, paddingLeft: 6, paddingRight: 4, paddingVertical: 4 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.accentDim }}>
                    {a.kind === "file" ? (
                      <AppIcon name={fileIconName(a.name)} size={15} color={theme.accentHi} />
                    ) : (
                      <AppIcon name={a.kind === "camera" ? "camera" : "image"} size={15} color={theme.accentHi} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, maxWidth: 110, flexShrink: 1 }}>{a.name ?? "файл"}</Text>
                  <Pressable onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== ai))} hitSlop={8} accessibilityLabel="Убрать вложение" style={{ width: 28, height: 28, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }}>
                    <AppIcon name="close" size={14} color={theme.mute} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {/* капсула ввода: #141416, радиус 26, без стекла и градиентов */}
          <Glass
            radius={25}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}
          >
            <Pressable
              onPress={() => setAttachOpen((v) => !v)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityLabel="Прикрепить"
            >
              <AppIcon name="plus" size={22} color={theme.text} />
            </Pressable>
            <TextInput
              value={text}
              onFocus={scrollBottom}
              onChangeText={(v) => {
                // если пользователь правит текст руками во время диктовки —
                // дальше распознанное дописывается к НОВОМУ тексту, а не затирает его
                if (!sttWriting.current) sttBase.current = v;
                setText(v);
              }}
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
            {recording ? (
              <Pressable
                onPress={toggleVoice}
                hitSlop={6}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Остановить запись"
              >
                <AppIcon name="stop" size={18} color="#fff" />
              </Pressable>
            ) : isStreaming(active?.id) ? (
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
                <AppIcon name="stop" size={18} color="#fff" />
              </Pressable>
            ) : text.trim() ? (
              <Pressable
                onPress={send}
                hitSlop={8}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Отправить"
              >
                <AppIcon name="send" size={20} color={theme.onAccent} />
              </Pressable>
            ) : (
              <Pressable
                onPress={toggleVoice}
                hitSlop={6}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Голосовой ввод"
              >
                <AppIcon name={recording ? "stop" : "mic"} size={22} strokeWidth={2.2} color={recording ? theme.danger : theme.text} />
              </Pressable>
            )}
          </Glass>

          {/* Вложения: капсула уезжает вверх, снизу выезжает панель из трёх плиток. */}
          {attachOpen && (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 8 }}>
              {[
                { icon: "camera" as const, label: "Камера", onPress: pickCamera },
                { icon: "image" as const, label: "Альбом", onPress: pickImage },
                { icon: "file" as const, label: "Файл", onPress: pickFile },
              ].map((b) => (
                <Pressable
                  key={b.label}
                  onPress={() => {
                    setAttachOpen(false);
                    b.onPress();
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 92,
                    borderRadius: 20,
                    backgroundColor: pressed ? theme.surface2 : theme.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                >
                  <AppIcon name={b.icon} size={24} color={theme.text} />
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "500" }}>{b.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Боковое меню: перо, отделы, поиск и сессии. */}
      <DrawerLineArt
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        theme={theme}
        t={t}
        models={allModels}
        currentModelName={model?.modelName}
        modelName={modelName}
        onSelectModel={(m) => { switchModel(m); setDrawerOpen(false); }}
        onNewChat={handleNewSession}
        onNavigate={openDrawerRoute}
        sessions={sessionList}
        activeId={active?.id ?? null}
        onSelectSession={openDrawerSession}
        search={search}
        onSearchChange={setSearch}
        onRename={renameSessionById}
        onDelete={deleteSessionById}
      />



      {/* ── Выбор модели: снизу, как панель вложений ── */}
      <Sheet
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        title="Модель"
        snapPoints={["auto"]}
        autoMaxPct={65}
      >
        {allModels.length === 0 && (
          <Text style={{ color: theme.dim, fontSize: 13, paddingVertical: 14 }}>Модели не подключены</Text>
        )}
        {allModels.map((m) => (
          <Pressable
            key={m.modelName}
            onPress={() => {
              switchModel(m);
              setModelPickerOpen(false);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 14,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>{m.displayName}</Text>
              <Text style={{ color: theme.dim, fontSize: 11.5, marginTop: 2, fontFamily: fonts.mono }}>{m.modelName}</Text>
            </View>
            {m.modelName === model?.modelName && <AppIcon name="check" size={18} color={theme.text} />}
          </Pressable>
        ))}
      </Sheet>

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
              <Text selectable style={{ color: theme.text, fontSize: 12.5, fontFamily: fonts.mono, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: 20, padding: 12, lineHeight: 19 }}>
                {detailTarget.tool.trim()}
                {detailTarget.toolOutput ? `\n\n${detailTarget.toolOutput.trim()}` : ""}
              </Text>
            ) : null}
            {detailTarget.thinking ? (
              <Text selectable style={{ color: theme.dim, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 19 }}>
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
 * Иконка файла по типу — те же AppIcon, что в меню «Прикрепить»:
 * архив → archive, документ/текст → description, остальное → insert-drive-file.
 */
function fileIconName(name?: string): AppIconName {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst"].includes(ext)) return "box";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "ods", "odp", "csv"].includes(ext)) return "file";
  return "file";
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
                      <AppIcon name={fileIconName(a.name)} size={16} color={theme.text} />
                      <Text numberOfLines={1} style={{ color: theme.userText, fontSize: 12, flexShrink: 1 }}>{a.name}</Text>
                    </View>
                  ) : (
                    <Image key={i} source={{ uri: a.uri }} style={{ width: 200, height: 200, borderRadius: 20, marginBottom: 6 }} resizeMode="cover" />
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
          {msg.error ? (
            <View style={{ marginTop: 6, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: theme.danger }}>
              <Text style={{ color: theme.danger, fontSize: 13 }}>{msg.error}</Text>
            </View>
          ) : null}
          {renderMarkdown(msg.content, theme)}
        </View>
      )}
      </Pressable>
      {/* действия: ТОЛЬКО в самом конце цепочки агента (или у юзера) — голые иконки, без коробок */}
            {showActions && !msg.streaming && (
              <View style={{ flexDirection: "row", justifyContent: user ? "flex-end" : "flex-start", marginTop: 8, gap: 2 }}>
                <Pressable onPress={onCopy} accessibilityLabel="Копировать" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                  <AppIcon name="copy" size={17} color={theme.dim} />
                </Pressable>
                <Pressable onPress={onShare} accessibilityLabel="Поделиться" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                  <AppIcon name="share" size={17} color={theme.dim} />
                </Pressable>
                {/* «Изменить» — только иконка, без текста (значок сам объясняет) */}
                {user && onEdit && (
                  <Pressable onPress={onEdit} accessibilityLabel="Изменить сообщение" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <AppIcon name="edit" size={17} color={theme.dim} />
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
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontFamily: fonts.sansDemi, lineHeight: 31 }}>
        Привет!{"\n"}Чем займёмся сегодня?
      </Text>
      <Text style={{ color: theme.dim, fontSize: 13.5, marginTop: 12, lineHeight: 21 }}>
        Спроси что угодно — помогу с кодом, проектами и задачами.
      </Text>
    </View>
  );
}
