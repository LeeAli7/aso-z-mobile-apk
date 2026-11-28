/**
 * Чат — основной экран. Прямой канал к провайдеру (core/gateway).
 * Сессии выезжают снизу (bottom sheet), модели — тоже sheet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  UIManager,
  findNodeHandle,
  AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { commit as hapticCommit, tap as hapticTap } from "../core/haptics";
import { LinearGradient } from "expo-linear-gradient";
import Reanimated, { FadeIn, FadeOut, LinearTransition, useSharedValue, useAnimatedStyle, withTiming, Easing as REasing } from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { Defs, LinearGradient as SvgGradient, Path as SvgPath, Rect as SvgRect, Stop, Svg } from "react-native-svg";
import { AppIcon, AppIconName } from "../design-system/components/AppIcon";
import { AttachmentStrip } from "../components/AttachmentStrip";
import { ModelPickerPopover } from "../components/ModelPickerPopover";
import RecTimer from "../components/RecTimer";
import { WaitLabel } from "../components/WaitLabel";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type ModelPrefs } from "../core/modelPrefs";
import { ApertureSpin } from "../design-system/components/ApertureMark";

import { useApp, genId, Msg, Session } from "../store/AppStore";
import { ModelInfo, streamChat, streamAgentChat, ChatMessage, ChatPart, AgentToolCall } from "../core/gateway";
import { buildAttachmentParts } from "../core/attachments";
import { sanitizeToolHistory } from "../core/history";
import { suggestSessionTitle } from "../core/sessionTitle";
import { setSessionTitleSink } from "../core/tools";
import { getToolDefsGated } from "../core/tools";
import { registerBg, unregisterBg } from "../core/background";
import { claimDueJobs, setJobResult } from "../core/cron";
import { runSelfReview } from "../core/selfImprove";
import { DrawerLineArt } from "../components/DrawerLineArt";
import { BgIndicator } from "../components/BgTasksSheet";
import { BgTasksPopover, type PopoverTask } from "../components/BgTasksPopover";
import { renderMarkdown, inlineFormulaText } from "../components/Markdown";
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
import { showError, showToast } from "../design-system/components/Toast";

/** Группа сообщений для ленты: chain = блок раздумий+команд, single = обычное сообщение. */
type Group =
  | { id: string; kind: "chain"; msgs: Msg[] }
  | { id: string; kind: "single"; msg: Msg };

// Мягкое затемнение: переход к фону длинный, 6 стопов с альфой — на Android
// два стопа давали видимую линию на стыке (интерполяция rgba упирается в 0).
type FadeStops = [string, string, string, string, string, string, string, string, string, string, string, string];

/** Опорные точки кривой затемнения: доля пути → плотность. */
// Чистый smoothstep: 1 → 0 без полки. Полка (alpha≈1 на первых 44%) давала
// излом, который на первом облачке читался как «половина резко потемнела».
// Сплошной фон под шапкой теперь отдельный блок, поэтому градиент может
// начинаться ровно с alpha=1 и уходить в ноль длинно и без ступени.

/**
 * 12 равномерных стопов вместо 6.
 *
 * На OLED плавный градиент из шести точек даёт ступени — их видно как
 * горизонтальную линию на светлых блоках под затемнением. Чем больше
 * стопов, тем меньше шаг плотности между ними и тем реже banding.
 */
function fadeStops(bg: string, shelf = 0): FadeStops {
  const m = /^#([0-9a-f]{6})$/i.exec(String(bg || "").trim());
  const r = m ? parseInt(m[1].slice(0, 2), 16) : 0;
  const g = m ? parseInt(m[1].slice(2, 4), 16) : 0;
  const b = m ? parseInt(m[1].slice(4, 6), 16) : 0;
  const s = Math.min(0.96, Math.max(0, shelf));
  const alphaAt = (v: number) => {
    const k = Math.min(1, Math.max(0, v));
    if (k <= s) return 1;                       // полка под шапкой
    const u = (k - s) / (1 - s);                // smoothstep: производная 0 на стыке
    return 1 - u * u * (3 - 2 * u);
  };
  const out: string[] = [];
  for (let i = 0; i < 64; i++) {
    const v = alphaAt(i / 63);
    out.push(`rgba(${r},${g},${b},${Number(v.toFixed(4))})`);
  }
  return out as FadeStops;
}

function fadeStopsDown(bg: string): FadeStops {
  const u = fadeStops(bg);
  return [...u].reverse() as FadeStops;
}

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
  // Последняя «жизненная» отметка стрима: токен, размышление, вызов
  // инструмента, прогресс команды. Нужна, чтобы застрявший флаг (запрос упал
  // так, что onError не позвали) не блокировал чат навсегда: с ним
  // sendText молча выходит, и сообщение пользователя просто НЕ появляется.
  const lastBeatRef = useRef<Record<string, number>>({});
  const beat = (sid: string) => {
    lastBeatRef.current[sid] = Date.now();
  };
  const STREAM_STALE_MS = 180_000;
  const isStreaming = (sid?: string | null) => {
    if (!sid || !streamingRef.current[sid]) return false;
    const last = lastBeatRef.current[sid] ?? 0;
    const run = runStateRef.current[sid];
    // Живой стрим всегда держит контроллер. Нет контроллера (или он уже
    // прерван) и 5 секунд тишины — флаг осиротел, снимаем сразу, не ждём три
    // минуты: иначе первое же сообщение после сбоя просто не отправится.
    const noCtrl = !run?.ctrl || run.ctrl.signal.aborted;
    if ((noCtrl && last && Date.now() - last > 5_000) || (last && Date.now() - last > STREAM_STALE_MS)) {
      // три минуты ни одного события — это не работа, а мёртвый флаг
      streamingRef.current[sid] = false;
      const r = runStateRef.current[sid];
      if (r) {
        r.stop = true;
        try { r.ctrl?.abort(); } catch {}
        r.ctrl = null;
      }
      return false;
    }
    return true;
  };
  const markStreaming = (sid: string, on: boolean) => {
    streamingRef.current[sid] = on;
    if (on) beat(sid);
    else delete lastBeatRef.current[sid];
    setStreamingSessions((p) => ({ ...p, [sid]: on }));
    // Основной агент — НЕ фоновая задача: ни в счётчике, ни в шторке.
    // Индикатор и окно процессов показывают только реальный фон
    // (рантайм, субагенты, расписание).
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
  const [msgMenuAt, setMsgMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  // мини-окно действий с сессией (долгое нажатие в панели)
  const [sessionMenuTarget, setSessionMenuTarget] = useState<Session | null>(null);
  // точка нажатия (pageX/pageY) — мини-меню сессии выезжает РЯДОМ С ПАЛЬЦЕМ,
  // а не шторкой снизу
  const [sessionMenuPoint, setSessionMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [editTarget, setEditTarget] = useState<Msg | null>(null);
  const [editValue, setEditValue] = useState("");
  // детали команды/раздумий — bottom-sheet как окно сессии
  const [detailTarget, setDetailTarget] = useState<Msg | null>(null);
  // прикрепление: окно-меню (фото/камера/файл) и выбранные вложения
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // ── Мультивложение (t9): массив выбранных файлов/фото ──
  const [attachments, setAttachments] = useState<{ kind: "image" | "camera" | "file"; uri: string; name?: string }[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);

  // ── Клавиатура (t4/t11): на Android капсула ввода должна подниматься над клавиатурой.
  // Манифест имеет adjustResize, но при плавающей капсуле/edge-to-edge он не срабатывает —
  // слушаем Keyboard и добавляем отступ снизу вручную. Это же убирает «чёрную полосу»
  // под капсулой: капсула висит над навигационной панелью, а не на ней.
  const [kbH, setKbH] = useState(0);
  // высота блока ввода: список снизу получает ровно такой отступ, иначе
  // последнее сообщение уходит под капсулу
  const [composerH, setComposerH] = useState(76);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sh = Keyboard.addListener("keyboardDidShow", (e) => setKbH(e.endCoordinates.height));
    const hd = Keyboard.addListener("keyboardDidHide", () => setKbH(0));
    // Бывает, что клавиатуру закрыли без события (уход в фон, смена экрана,
    // свайп по клавиатуре на некоторых прошивках) — kbH «залипал», и капсула
    // висела в середине экрана. Возвращаясь в приложение, сбрасываем высоту.
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") setKbH(0);
    });
    return () => { sh.remove(); hd.remove(); sub.remove(); };
  }, []);
  // ── окно хранилища (проекты + файлы + инструкции, как у Hermes) ──
  const [projects, setProjects] = useState<VibeProject[]>([]);
  // шторка фоновых процессов (рантайм/cron/делегация) — открывается только при наличии запущенных
  const [bgOpen, setBgOpen] = useState(false);
  const [bgTasks, setBgTasks] = useState<PopoverTask[]>([]);
  const [bgCount, setBgCount] = useState(0);
  // Прямоугольники кнопок в координатах экрана: окна растут ИЗ них, поэтому
  // кнопка не остаётся висеть «под окном» — она же и превращается в окно.
  const pillRef = useRef<View>(null);
  const chipRef = useRef<View>(null);
  const [pillBox, setPillBox] = useState({ x: 0, y: 0, w: 118, h: 40 });
  // прогресс морфа кнопка→окно: один shared value на оба, иначе кнопка
  // пропадает мгновенно и окно «появляется поверх» неё
  const pickerProg = useSharedValue(0);
  const [chipBox, setChipBox] = useState({ x: 0, y: 0, w: 47, h: 40 });
  // морф чип→окно: один прогресс на кнопку и окно (как у выбора модели)
  const bgProg = useSharedValue(0);
  const chipStyle = useAnimatedStyle(() => ({ opacity: 1 - bgProg.value }));
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Кэш габаритов кнопки: measureInWindow — это round-trip в нативный слой,
  // из-за него окно открывалось на кадр-два позже касания. Меряем на layout.
  const pillBoxRef = useRef({ x: 0, y: 0, w: 118, h: 40 });
  const measurePill = useCallback(() => {
    pillRef.current?.measureInWindow((x, y, w, h) => {
      if (!w || !h) return;
      pillBoxRef.current = { x, y, w, h };
    });
  }, []);
  const openPicker = useCallback(() => {
    // открываем в тот же кадр, геометрия уже известна
    setPillBox(pillBoxRef.current);
    setModelPickerOpen(true);
  }, []);

  // Кэш габаритов чипа — как у пилюли модели: measureInWindow давал
  // открытие на кадр-два позже касания, из-за этого окно «дёргалось».
  const chipBoxRef = useRef({ x: 0, y: 0, w: 47, h: 40 });
  const measureChip = useCallback(() => {
    chipRef.current?.measureInWindow((x, y, w, h) => {
      if (!w || !h) return;
      chipBoxRef.current = { x, y, w, h };
    });
  }, []);

  const closeBg = useCallback(() => {
    bgProg.value = withTiming(0, { duration: 170, easing: REasing.bezier(0.4, 0, 0.6, 1) });
    setTimeout(() => setBgOpen(false), 40);
  }, []);

  const openBg = useCallback(() => {
    setChipBox(chipBoxRef.current);
    bgProg.value = withTiming(1, { duration: 240, easing: REasing.bezier(0.16, 0.84, 0.24, 1) });
    setBgOpen(true);
    void (async () => {
      try {
        const { listRunning } = await import("../core/background");
        const reg = await listRunning();
        const extra = reg.filter((t) => t.kind !== "stream");
        setBgTasks((prev) => {
          const ids = new Set(extra.map((t) => t.id));
          const keep = prev.filter((t) => t.kind === "stream" || !ids.has(t.id));
          return [...keep, ...extra];
        });
      } catch {
        /* реестр недоступен — показываем то, что уже знаем */
      }
    })();
  }, []);

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
  const waveApi = useRef<((v: number) => void) | null>(null);
  // Кольцо вокруг микрофона: окутывает кнопку при старте записи и дышит
  // вместе с голосом. Живёт на UI-потоке — кадры не ждут JS.
  const vol = useSharedValue(0);
  const volPeak = useRef(0.18);
  const recP = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: recP.value * (0.2 + 0.62 * vol.value),
    transform: [{ scale: recP.value * (0.96 + 0.2 * vol.value) }],
  }));
  // запись уже включена визуально (линия/таймер), даже если разрешение ещё спрашивается
  const recOnRef = useRef(false);
  const sttRetry = useRef(0);
  const sttTimer = useRef<any>(null);
  const permRef = useRef<boolean | null>(null);
  const voiceCfgRef = useRef<any>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { loadVoiceConfig } = await import("../core/voice");
        voiceCfgRef.current = await loadVoiceConfig();
      } catch { /* настроек нет — стартуем с дефолтами */ }
    })();
  }, []);
  // 0 — обычная капсула, 1 — диктовка: левая кнопка сжата, линия во всю ширину
  const recProg = useSharedValue(0);
  useEffect(() => {
    recProg.value = withTiming(recording ? 1 : 0, {
      duration: recording ? 220 : 180,
      easing: REasing.out(REasing.cubic),
    });
  }, [recording, recProg]);
  const leftStyle = useAnimatedStyle(() => ({
    width: 40 * (1 - recProg.value),
    opacity: 1 - recProg.value,
    marginRight: -8 * recProg.value,
    overflow: "hidden",
  }));
  // true ровно на время программной записи текста из STT: ручной ввод пользователя
  // в это окно не должен считаться частью распознанной фразы.
  useEffect(() => {
    recP.value = withTiming(recording ? 1 : 0, { duration: 220, easing: REasing.out(REasing.cubic) });
    // Страховка: если анимация не доехала (прервали/успели размонтировать
    // часть дерева), кнопка «+» оставалась сжатой в ноль. Через 300 мс
    // после конца записи ставим ноль жёстко.
    if (!recording) {
      const id = setTimeout(() => { recP.value = 0; }, 300);
      return () => clearTimeout(id);
    }
  }, [recording, recP]);


  const sttWriting = useRef(false);
  const sttLive = useRef("");
  const lastSaid = useRef("");
  // Сторож: если распознавание молча умерло (Android умеет закрывать сессию
  // без события end), поднимаем его заново, пока идёт запись.
  const lastEv = useRef(0);
  // Два способа говорить: тап — «включил и говори, вторым тапом отправил»,
  // удержание — «держишь, пока говоришь». Различаем по длительности касания.
  const pressAt = useRef(0);
  const pressStarted = useRef(false);
  const stopAt = useRef(0);
  const lastOut = useRef(0);
  const tapMode = useRef(false);
  const pendingSend = useRef(false);
  const textRef = useRef("");
  const sendTextRef = useRef<(s: string) => void>(() => {});
  useEffect(() => { textRef.current = text; }, [text]);
  useSpeechRecognitionEvent("result", (e: any) => {
    sttRetry.current = 0;
    lastEv.current = Date.now();
    const txt = String(e?.results?.[0]?.transcript ?? "").trim();
    if (!txt) return;
    // Пока идёт диктовка, в капсуле бегут только строки: распознанный текст
    // копим в ref и показываем один раз после остановки. Раньше каждый
    // промежуточный результат перерисовывал весь экран — отсюда лаги и
    // «замирание» дорожки на речи.
    if (recOnRef.current) { sttLive.current = txt; return; }
    const base = sttBase.current.trim();
    const merged = base ? base + " " + txt : txt;
    sttWriting.current = true;
    setText(merged);
    setTimeout(() => { sttWriting.current = false; }, 0);
    // base НЕ фиксируем на isFinal: Android присылает кумулятивный транскрипт,
    // и «промежуточный финал + финал» давал проговорённые слова по 2-3 раза.
  });
  // Android часто отдаёт no-speech сразу после старта (микрофон ещё не открылся,
  // аудиофокус держит прошлая сессия). В этом случае не рвём запись, а
  // перезапускаем распознавание — иначе кнопка «отменяется» сама.
  const sttStart = useCallback(() => {
    const lang = state.lang === "en" ? "en-US" : "ru-RU";
    // В dev-клиенте нативного модуля может не быть (APK собран без него) —
    // тогда ExpoSpeechRecognitionModule приходит пустым и вызов падает.
    if (!ExpoSpeechRecognitionModule || typeof ExpoSpeechRecognitionModule.start !== "function") {
      if (__DEV__) console.log("[stt] модуль распознавания недоступен в этой сборке");
      showToast("err", "Голосовой ввод недоступен в этой сборке");
      return;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 60 },
      } as any);
    } catch (e) {
      if (__DEV__) console.log("[stt] start failed", String(e));
      showToast("err", String(e));
    }
  }, [state.lang]);

  useSpeechRecognitionEvent("error", (e: any) => {
    if (__DEV__) console.log("[stt] error", JSON.stringify(e)?.slice(0, 300));
    const code = String(e?.error ?? "");
    // Фатальные — только те, что не лечатся перезапуском.
    const fatal = code === "not-allowed" || code === "service-not-allowed"
      || code === "language-not-supported" || code === "audio-capture";
    // Любая другая ошибка (тишина, aborted, client, network) — не повод гасить
    // микрофон: пока пользователь не нажал стоп, распознавание поднимается снова.
    // Любая не-фатальная ошибка: сессию поднимаем заново, пока пользователь
    // не нажал стоп. Раньше «client»/«network» гасили запись — из-за этого
    // одиночный тап выглядел как «не включился».
    if (recOnRef.current && !fatal) {
      sttRetry.current += 1;
      if (sttRetry.current > 40) { recOnRef.current = false; setRecording(false); return; }
      const soft = code === "no-speech" || code === "speech-timeout" || code === "aborted";
      clearTimeout(sttTimer.current);
      sttTimer.current = setTimeout(() => {
        if (!recOnRef.current) return;
        try { sttStart(); } catch { /* следующий тап начнёт заново */ }
      }, soft ? 600 : 1200);
      return;
    }
    recStarting.current = false;
    recOnRef.current = false;
    setRecording(false);
  });
  useSpeechRecognitionEvent("end", () => {
    if (__DEV__) console.log("[stt] end");
    recStarting.current = false;
    // Android завершает сессию на паузе в речи. Пока пользователь не нажал
    // стоп — поднимаем её заново, иначе кнопка «отваливается» на тишине.
    if (recOnRef.current) {
      clearTimeout(sttTimer.current);
      sttTimer.current = setTimeout(() => {
        if (!recOnRef.current) return;
        try { sttStart(); } catch {}
      }, 250);
      return;
    }
    setRecording(false);
    // Остановка по второму тапу/отпусканию — сразу отправляем сказанное.
    if (pendingSend.current) {
      pendingSend.current = false;
      const said = (lastSaid.current || textRef.current).trim();
      lastSaid.current = "";
      if (said) setTimeout(() => sendTextRef.current(said), 0);
    }
  });
  useEffect(() => {
    if (!recording) return;
    lastEv.current = Date.now();
    const id = setInterval(() => {
      if (!recOnRef.current) return;
      if (Date.now() - lastEv.current < 5000) return;
      lastEv.current = Date.now();
      try { sttStart(); } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [recording, sttStart]);
  // rms с микрофона: 10-20 событий в секунду, рисуем не чаще 22 кадров
  useSpeechRecognitionEvent("volumechange", (e: any) => {
    const raw = Number(e?.value ?? 0);
    waveApi.current?.(raw);
    // Android отдаёт примерно -2..10 dB: нормализуем в 0..1.
    lastEv.current = Date.now();
    const lvl = Math.max(0, Math.min(1, (raw + 2) / 12));
    volPeak.current = Math.max(lvl, volPeak.current * 0.975, 0.18);
    vol.value = withTiming(Math.min(1, lvl / volPeak.current), { duration: 90 });
  });
  /** Остановить запись. sendIt — отправить сказанное сразу. */
  const stopVoice = useCallback((sendIt: boolean) => {
    recOnRef.current = false;
    stopAt.current = Date.now();
    clearTimeout(sttTimer.current);
    pendingSend.current = sendIt;
    const said = [sttBase.current.trim(), sttLive.current.trim()].filter(Boolean).join(" ");
    sttLive.current = "";
    lastSaid.current = said;
    if (said) setText(said);
    hapticCommit();
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
    setRecording(false);
  }, []);

  const startVoice = useCallback(async () => {
    if (recStarting.current) return;
    recStarting.current = true;
    recOnRef.current = true;

    // Отклик не ждёт разрешений и конфига: вибро, клавиатура вниз, линия и
    // таймер стартуют в тот же кадр. Раньше кнопка «думала» 200–400 мс,
    // потому что до setRecording(true) шли динамический импорт и чтение настроек.
    hapticCommit();
    Keyboard.dismiss();
    sttBase.current = text.trim();
    setRecording(true);
    closeAttach();

    const rollback = (msg: string) => {
      recOnRef.current = false;
      recStarting.current = false;
      setRecording(false);
      if (msg) showToast("err", msg);
    };

    try {
      let voice = voiceCfgRef.current;
      if (!voice) {
        const { loadVoiceConfig } = await import("../core/voice");
        voice = await loadVoiceConfig().catch(() => null);
        voiceCfgRef.current = voice;
      }
      if (voice && !voice.sttEnabled) {
        rollback("Голосовой ввод выключен в настройках");
        return;
      }
      // разрешение спрашиваем один раз за жизнь экрана
      if (permRef.current !== true) {
        const perm: any = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null);
        const granted = perm == null ? true : (perm.granted ?? perm.status === "granted");
        permRef.current = granted;
        if (!granted) {
          rollback("Нет доступа к микрофону");
          return;
        }
      }
      // Сразу после удержания прошлая сессия ещё закрывается — если стартовать
      // в тот же миг, start() падает и тап «сбрасывается». Ждём остаток паузы.
      const since = Date.now() - stopAt.current;
      if (since < 350) await new Promise((r) => setTimeout(r, 350 - since));
      if (!recOnRef.current) return; // успели остановить, пока шёл запрос
      sttRetry.current = 0;
      sttStart();
    } catch (e: any) {
      rollback(String(e?.message || e));
    } finally {
      recStarting.current = false;
    }
  }, [state.lang, text]);

  // Жест микрофона — на onPress/onLongPress, без ручного замера времени:
  // тап решает onPress (он приходит один раз), удержание — onLongPress.
  // Ручной таймер путался с повторными onPressOut и «съедал» одиночный тап.
  const startedHere = useRef(false);
  const isHold = useRef(false);

  const onMicPressIn = useCallback(() => {
    if (recOnRef.current) { startedHere.current = false; return; }
    startedHere.current = true;
    tapMode.current = true;
    startVoice();
  }, [startVoice]);

  const onMicPress = useCallback(() => {
    if (startedHere.current) { startedHere.current = false; return; } // первый тап: слушаем дальше
    if (recOnRef.current) stopVoice(true);                            // второй тап: отправка
  }, [stopVoice]);

  const onMicLongPress = useCallback(() => {
    isHold.current = true;
  }, []);

  const onMicPressOut = useCallback(() => {
    if (!isHold.current) return;
    isHold.current = false;
    if (recOnRef.current) stopVoice(true);                            // отпустил — отправка
  }, [stopVoice]);
  const listRef = useRef<FlatList<any>>(null);
  const listOffsetY = useRef(0);
  const listH = useRef(0);

  // Вертикаль по таблице больше не ведём вручную: жест остаётся у списка,
  // иначе прокрутка дёргалась на каждом кадре.

  // Плавное открытие сессии: список монтируется целиком, потом один прыжок
  // в низ без анимации и мягкое проявление — без поэтапного дёрганья.
  const listFade = useRef(new Animated.Value(1)).current;
  // Шторка переключения сессии: сам чат не гасим (переключение мгновенное),
  // но пока список доезжает — показываем знак, чтобы не было «щелчка».
  const [switchOn, setSwitchOn] = useState(false);
  const switchFade = useRef(new Animated.Value(0)).current;
  // лоадер уже показан вручную (тап по сессии) — не проигрывать появление заново
  const switchInstant = useRef(false);
  const [listReady, setListReady] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const jumpAnim = useRef(new Animated.Value(0)).current;
  // Плюс → красный крест: поворот 0→45° и смена цвета.
  // панель вложений: прогресс живёт на UI-потоке. Раньше высоту вёл
  // Animated с useNativeDriver:false — каждый кадр пересобирал 200 полосок
  // подложки и перекладывал список, отсюда рывки.
  // низ связки над клавиатурой/жестом — панель вложений встаёт ровно сюда
  const compPadBottom = Platform.OS === "android" ? kbH + Math.max(insets.bottom, 8) + 8 : insets.bottom + 8;
  const attachProg = useSharedValue(0);
  const [attachOpen, setAttachOpen] = useState(false);
  // Вся связка «лента вложений + капсула + панель» поднимается одним transform.
  // Никакого пересчёта height: layout не меняется, список не перекладывается,
  // composerH не дёргается — отсюда пропавшие рывки.
  const attachLift = useAnimatedStyle(() => ({
    transform: [{ translateY: -110 * attachProg.value }],
  }));
  const attachPanelStyle = useAnimatedStyle(() => ({
    opacity: attachProg.value,
    transform: [{ translateY: (1 - attachProg.value) * 8 }],
  }));
  // Плюс и крест живут на ОДНОМ значении attachProg. Раньше их вело отдельное
  // Animated.Value: после серии нажатий крест оставался при закрытой панели,
  // а панель висела с pointerEvents="none". Рассогласоваться теперь нечему.
  const plusIconStyle = useAnimatedStyle(() => ({
    opacity: recording ? 0 : 1 - attachProg.value,
    transform: [{ rotate: `${45 * attachProg.value}deg` }],
  }));
  const closeIconStyle = useAnimatedStyle(() => ({
    opacity: recording ? 0 : attachProg.value,
    transform: [{ rotate: `${-45 + 45 * attachProg.value}deg` }],
  }));
  // Лента вложений появляется и исчезает сама, вне потока — капсулу не сдвигает.
  const stripProg = useSharedValue(0);
  const [stripMounted, setStripMounted] = useState(false);
  useEffect(() => {
    if (attachments.length > 0) {
      setStripMounted(true);
      stripProg.value = withTiming(1, { duration: 220, easing: REasing.out(REasing.cubic) });
      return;
    }
    stripProg.value = withTiming(0, { duration: 160, easing: REasing.in(REasing.cubic) });
    const id = setTimeout(() => setStripMounted(false), 190);
    return () => clearTimeout(id);
  }, [attachments.length, stripProg]);
  const stripStyle = useAnimatedStyle(() => ({
    opacity: stripProg.value,
    transform: [{ translateY: (1 - stripProg.value) * 10 }],
  }));

  /** Закрыть панель откуда угодно (тайл, выбор файла, клавиатура).
   *  Раньше тайлы звали только setAttachOpen(false), а анимация оставалась
   *  на 1: панель висела раскрытой с pointerEvents="none" — видно, но не нажать.
   *  Отсюда и «приходится закрывать и открывать заново». */
  const closeAttach = useCallback(() => {
    setAttachOpen(false);
    attachProg.value = withTiming(0, { duration: 200, easing: REasing.in(REasing.cubic) });
  }, [attachProg]);

  const active = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  const allModels = [...state.models, ...state.customModels];
  // что показать «работает» в списке сессий: реестр стримов + флаг у сообщения
  const liveSessions = useMemo(() => {
    const o: Record<string, boolean> = { ...streamingSessions };
    for (const s of state.sessions) {
      const last = s.messages[s.messages.length - 1] as any;
      if (last?.streaming) o[s.id] = true;
    }
    return o;
  }, [state.sessions, streamingSessions]);
  const model = allModels.find((m) => m.modelName === active?.modelId) ?? allModels[0];
  // Рассуждение и контекст — свои у каждой модели, живут в AsyncStorage.
  const [prefs, setPrefs] = useState<ModelPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    let alive = true;
    const name = model?.modelName;
    if (!name) return;
    void loadPrefs(name).then((p) => {
      if (alive) setPrefs(p);
    });
    return () => {
      alive = false;
    };
  }, [model?.modelName]);
  const applyPrefs = useCallback(
    (p: ModelPrefs) => {
      setPrefs(p);
      if (model?.modelName) void savePrefs(model.modelName, p);
    },
    [model?.modelName],
  );
  // встроенных моделей больше нет: пока своя не добавлена — «Модель», а не «Aso»
  const modelName = model?.displayName ?? "Модель";
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

  // Автоскролл вниз — ТОЛЬКО если пользователь уже у нижней кромки.
  // Раньше onContentSizeChange вызывал scrollToEnd на каждый токен стрима,
  // поэтому при прокрутке вверх чат рывком возвращал вниз — до верха не достать.
  const atBottom = useRef(true);
  const stickTimer = useRef<any>(null);
  // Пока идёт наша прокрутка — события скролла не должны решать, что мы «ушли
  // наверх»: контент растёт быстрее, и раньше из-за этого чат замирал на
  // 1–2 вызовах выше последнего.
  const progUntil = useRef(0);
  const rowRefs = useRef<Record<string, any>>({});
  const rowY = useRef<Record<string, number>>({});
  // настоящая высота содержимого: по ней доезжаем до низа без промахов
  const contentH = useRef(0);

  /** Прокрутить в самый низ и добрать после раскладки (карточка/картинка выше). */
  const doScrollEnd = (animated = true) => {
    atBottom.current = true;
    progUntil.current = Date.now() + 600;
    const l = listRef.current;
    if (!l) return;
    const end = () => {
      const h = contentH.current;
      if (h > 0) l.scrollToOffset({ offset: h, animated: false });
      else l.scrollToEnd({ animated: false });
      progUntil.current = Date.now() + 300;
    };
    end();
    // Контент растёт (карточка команды, картинка, строка таблицы) уже после
    // первого прыжка — добираем до настоящего низа несколько раз.
    [80, 220, 480].forEach((ms) => setTimeout(end, ms));
  };

  /** Финальный ответ: показать его НАЧАЛО и перестать тянуть чат вниз. */
  const anchorFinal = (id: string) => {
    atBottom.current = false;
    // Позицию строки знаем из onLayout: на Fabric UIManager.measureLayout
    // недоступен, из-за чего раньше срабатывал fallback и экран уезжал в конец.
    const jump = (animated: boolean) => {
      const y = rowY.current[id];
      if (y == null) return false;
      progUntil.current = Date.now() + 600;
      listRef.current?.scrollToOffset({ offset: Math.max(0, y - 88), animated });
      return true;
    };
    if (!jump(true)) {
      doScrollEnd(true);
      return;
    }
    // ответ ещё дописывается — возвращаемся к его началу, если уехали
    [160, 380].forEach((ms) =>
      setTimeout(() => {
        if (!atBottom.current) jump(false);
      }, ms),
    );
  };

  const stickBottom = (force = false) => {
    if (force) atBottom.current = true;
    if (!force && !atBottom.current) return;
    if (stickTimer.current) clearTimeout(stickTimer.current);
    stickTimer.current = setTimeout(() => {
      stickTimer.current = null;
      if (!force && !atBottom.current) return;
      doScrollEnd(true);
    }, 60);
  };
  const scrollBottom = () => stickBottom();

  // модель ещё не выдала ни одного токена — вместо пустого пузыря показываем
  // пульс капсулы; как только пошёл текст, индикатор исчезает
  // пока модель не выдала текст — знак ждёт слева под последним блоком
  // (размышлением или командой), как продолжение цепочки
  const waitingFirst = useMemo(() => {
    if (!active) return false;
    const last = active.messages[active.messages.length - 1] as any;
    if (!last) return false;
    // «живой» ход: либо в реестре стримов, либо у самого сообщения флаг streaming
    const live = isStreaming(active.id) || !!last.streaming;
    if (!live) return false;
    if (last.role === "user") return true; // ответ ещё не начался
    return !last.content; // размышление/команда уже есть, текста ещё нет
  }, [active, streamingSessions]);

  // ── Автоназвание сессии ──
  // Имя ставится уже после первой пары реплик и уточняется на второй и третьей:
  // по одному разу на каждую длину переписки. Ручное переименование выключает
  // механику навсегда, а имя, которое дал сам агент инструментом, тоже считается
  // ручным — его больше не перебиваем.
  const titleTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = active;
    if (!s || !model) return;
    if (s.titleEdited) return;
    const users = s.messages.filter((m) => m.role === "user" && m.content && !m.content.startsWith("/"));
    if (users.length < 1 || users.length > 3) return;
    const key = `${s.id}:${users.length}`;
    if (titleTried.current.has(key)) return;
    if (s.messages.some((m) => m.streaming)) return;
    if (!s.messages.some((m) => m.role === "assistant" && m.content)) return;
    titleTried.current.add(key);
    if (getRun(s.id).ctrl) return; // ход ещё идёт
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    void (async () => {
      try {
        // Имя даём в самом конце хода: сначала ответ, инструменты, отправка —
        // и только потом один запрос на название. Не отнимаем квоту у ответа.
        await new Promise((r) => setTimeout(r, 2500));
        if (getRun(s.id).ctrl) return; // за это время начался новый ход
        const { recentlyRateLimited } = await import("../core/gateway");
        if (recentlyRateLimited(45000)) return; // только что упёрлись в лимит — не добиваем
        const title = await suggestSessionTitle(model, s.messages as any, ctrl.signal);
        if (!title) return;
        dispatch({ type: "UPDATE_SESSION", sessionId: s.id, patch: { name: title, titleAuto: true } });
      } finally {
        clearTimeout(timer);
      }
    })();
  }, [active, model, dispatch]);

  // Агент переименовывает текущую сессию инструментом rename_session:
  // имя считается ручным и автонеймом больше не перебивается.
  useEffect(() => {
    if (!active?.id) { setSessionTitleSink(null); return; }
    const sid = active.id;
    setSessionTitleSink((title) => {
      dispatch({
        type: "UPDATE_SESSION",
        sessionId: sid,
        patch: { name: title, titleAuto: true, titleEdited: true },
      });
    });
    return () => setSessionTitleSink(null);
  }, [active?.id, dispatch]);

  // Смена сессии — сразу к последнему сообщению. Никакой шторки и чёрного
  // экрана: сообщения уже в памяти, поэтому прыгаем в низ в тот же кадр.
  useEffect(() => {
    setListReady(true);
    listRef.current?.scrollToEnd({ animated: true });
    // высота контента в момент вызова ещё старая — добираем после раскладки
    [60, 180, 420].forEach((d) =>
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), d),
    );
    if (!switchInstant.current) {
      setSwitchOn(true);
      switchFade.setValue(0);
      Animated.timing(switchFade, {
        toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
    switchInstant.current = false;
    const t = setTimeout(() => {
      Animated.timing(switchFade, {
        toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setSwitchOn(false);
      });
    }, 90);
    return () => clearTimeout(t);
  }, [active?.id, switchFade]);

  useEffect(() => {
    Animated.timing(jumpAnim, {
      toValue: showJump ? 1 : 0,
      duration: 170,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [showJump, jumpAnim]);

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
    closeAttach();
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
    closeAttach();
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
    closeAttach();
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
    async (raw: string, opts?: { sessionId?: string }) => {
      const content = raw.trim();
      // targetSession: крон-запуски идут в СВОЮ сессию, а не в открытую
      let sid = opts?.sessionId ?? active?.id;
      if (!content || isStreaming(sid)) return;
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

      // Сообщение уходит в чат ДО любых проверок модели и сети: даже если
      // дальше ошибка, текст пользователя уже виден в переписке.
      const userMsgId = genId();
      dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: userMsgId, role: "user", content, ...(attachments.length ? { attachments: [...attachments] } : {}) } });
      setAttachments([]);
      setText("");

      if (!model) {
        // встроенные модели удалены: пока своя не добавлена — отвечаем в чате
        dispatch({
          type: "ADD_MSG", sessionId: sid,
          msg: { id: genId(), role: "assistant", content: "Нет подключённой модели — добавьте свою в Настройки → Провайдеры." },
        });
        return;
      }

      markStreaming(sid, true);
      getRun(sid).stop = false;
      // отправил сообщение — принудительно вниз, даже если читал историю выше
      stickBottom(true);

      // Всё, что ниже, может бросить исключение (файлы вложений, подготовка
      // инструментов, сбой провайдера). Без этого блока флаг streaming
      // оставался включённым навсегда, и следующий sendText молча выходил —
      // сообщение пользователя не появлялось в чате вообще (лечилось только
      // новым чатом). Теперь флаг снимается в любом случае.
      try {
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
      let agentTokAt = 0;
      let agentTokTimer: ReturnType<typeof setTimeout> | null = null;
      // финальный ответ уже заякорен: показываем его начало и не тянем вниз
      let anchored = false;
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
        beat(sid);
        acc += tok;
        textAcc += tok;
        // как и в обычном пути: экран не чаще ~18 раз в секунду, иначе
        // каждый токен перерисовывал весь чат и интерфейс подвисал
        const paintText = () => {
          if (!textId) {
            textId = genId();
            dispatch({ type: "ADD_MSG", sessionId: sid, msg: { id: textId, role: "assistant", content: textAcc, streaming: true } });
          } else {
            dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: textId, patch: { content: textAcc } });
          }
          // Итоговый ответ после инструментов: как только текста набралось на
          // пару строк — показываем его НАЧАЛО и отпускаем автоскролл.
          // Короткие «сейчас проверю» перед следующим вызовом не заякоривают.
          if (!anchored && toolIds.length > 0 && textAcc.length > 120 && textId) {
            anchored = true;
            const id = textId;
            setTimeout(() => anchorFinal(id), 120);
          }
          if (!anchored) scrollBottom();
        };
        const nowTok = Date.now();
        if (nowTok - agentTokAt >= 55) {
          agentTokAt = nowTok;
          paintText();
        } else if (!agentTokTimer) {
          agentTokTimer = setTimeout(() => {
            agentTokTimer = null;
            agentTokAt = Date.now();
            paintText();
          }, 55);
        }
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
        beat(sid);
        // Порядок «раздумья → ответ» должен быть ВСЕГДА, даже если провайдер
        // отдал reasoning-чанки уже после первых токенов ответа (бывает у
        // reasoning-моделей и при ретраях): в этом случае думалка приклеивается
        // к текстовому сообщению и рисуется НАД ним, а не отдельной карточкой снизу.
        if (!thinkId && textId) {
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
        beat(sid);
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
      const onToolResult = (_call: AgentToolCall, ok: boolean, result: string, brokenCall?: boolean) => {
        beat(sid);
        if (getRun(sid).stop) return;
        const tid = toolIds[toolIdx++];
        if (!tid) return;
        if (brokenCall) {
          // Битый вызов (чужое имя инструмента, кривой JSON) — не наша проблема
          // в UI: карточку убираем, модель получает ошибку и шлёт исправленный вызов.
          dispatch({ type: "DELETE_MSG", sessionId: sid, msgId: tid });
          return;
        }
        // обычный провал команды (exit 1) — это результат, его показываем
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
          const fid = textId;
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: fid,
            patch: { content: finalText || textAcc || "", streaming: false },
          });
          textId = null;
          // короткий финальный ответ (не успел заякориться в стриме):
          // показываем его начало, а не хвост
          if (!anchored && toolIds.length > 0) {
            anchored = true;
            setTimeout(() => anchorFinal(fid), 140);
          }
        }
      };
      const onError = (err: string, partial?: any[]) => {
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
        // Ошибку в чат не пишем: плашка сверху с кодом. В пузыре остаётся
        // только то, что модель успела сказать до сбоя.
        if (textId) {
          dispatch({
            type: "UPDATE_MSG", sessionId: sid, msgId: textId,
            patch: { streaming: false, content: textAcc || "" },
          });
        }
        // Провал виден в чате: сообщение остаётся, рядом появляется «Повторить».
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: userMsgId, patch: { failed: true } });
        // Даже при сбое сохраняем то, что агент успел сделать: иначе следующий
        // ход начинается «с чистого листа» и модель отвечает «привет».
        if (Array.isArray(partial) && partial.length > 0) {
          const trimmed = sanitizeToolHistory(
            partial
              .filter((m) => m.role !== "system")
              .slice(-30)
              .map((m) => {
                const c = typeof m.content === "string" ? m.content : "";
                return c.length > 6000 ? { ...m, content: c.slice(0, 6000) + "\n…(обрезано)" } : m;
              }),
          );
          dispatch({ type: "UPDATE_SESSION", sessionId: sid, patch: { agentHistory: trimmed } });
        }
        showError(err);
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
                const trimmed = sanitizeToolHistory(
                  messages
                    .filter((m) => m.role !== "system")
                    .slice(-30)
                    .map((m) => {
                      const c = typeof m.content === "string" ? m.content : "";
                      return c.length > 6000 ? { ...m, content: c.slice(0, 6000) + "\n…(обрезано)" } : m;
                    }),
                );
                dispatch({ type: "UPDATE_SESSION", sessionId: sid, patch: { agentHistory: trimmed } });
              }
              // ── Self-improve (P1.3): после сложного хода (2+ тула) тихо анализируем ──
              // Скрытый ревьюер после каждого хода с 2+ тулами — это ещё один
              // агентский цикл запросов к той же модели. На бесплатных тарифах
              // он и выбивал 429. Выключен по умолчанию.
              const SELF_REVIEW_ENABLED = false;
              if (SELF_REVIEW_ENABLED && !getRun(sid).stop && usedTools.size >= 2 && !hadToolError) {
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
          { projectId: proj?.id, cwd: proj ? projectDirPath(proj.id) : undefined, onToolProgress: (msg) => { beat(sid); if (!getRun(sid).stop) setToolNote(msg); } },
        );
      } else {
        await streamChat(model, chatMessages, {
          onToken,
          onThinking,
          onDone: (clean) => { void finalize(clean || acc); },
          onError,
        }, ctrl.signal, { maxTokens: prefs.ctx, reasoning: prefs.reasoning });
      }
      } catch (e: any) {
        // Ход упал мимо onError — показываем причину и оставляем сообщение с
        // кнопкой повтора, а не тишину.
        console.warn("[chat] ход упал мимо onError:", e?.message ?? e);
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: userMsgId, patch: { failed: true } });
        if (!getRun(sid).stop) showError(String(e?.message ?? e));
      } finally {
        markStreaming(sid, false);
        getRun(sid).ctrl = null;
      }
    },
    [active, dispatch, model, setActive, scrollBottom, attachments, runSlashCommand, streamingSessions, prefs.ctx, prefs.reasoning],
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
          // Каждый запуск — СВОЯ сессия «Крон · имя · дата». Раньше автозадача
          // выполнялась в открытом чате: её отчёт попадал в историю, и агент на
          // каждое следующее сообщение снова отвечал по старой автозадаче.
          const cronId = genId();
          const d = new Date();
          const p2 = (n: number) => String(n).padStart(2, "0");
          const stamp = `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
          dispatch({
            type: "ADD_SESSION",
            session: {
              id: cronId,
              name: `Крон · ${job.name} · ${stamp}`,
              messages: [],
              modelId: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              cron: true,
            },
          });
          void sendText(prompt, { sessionId: cronId }).then(() => {
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
  }, [model, sendText, active?.id, dispatch]);

  const send = useCallback(() => {
    if (text.trim()) sendText(text);
  }, [text, sendText]);
  // Повтор неудачной отправки: сообщение уходит из чата и отправляется заново.
  const retrySend = useCallback((m: Msg) => {
    if (!active || isStreaming(active.id)) return;
    const sid = active.id;
    hapticTap();
    dispatch({ type: "DELETE_MSG", sessionId: sid, msgId: m.id });
    setTimeout(() => sendText(m.content, { sessionId: sid }), 0);
  }, [active, dispatch, sendText]);

  // Отмена хода, пока агент не ответил: вопрос убираем из чата, а его текст
  // возвращаем в капсулу — человек хотел поправить, а не потерять написанное.
  const cancelTurn = useCallback((): boolean => {
    const s = active;
    if (!s) return false;
    const msgs = s.messages;
    let ui = -1;
    for (let i = msgs.length - 1; i >= 0; i -= 1) if (msgs[i].role === "user") { ui = i; break; }
    if (ui < 0) return false;
    const answered = msgs.slice(ui + 1).some((m) => m.role === "assistant" && m.content.trim());
    if (answered) return false;
    const q = msgs[ui];
    for (const m of msgs.slice(ui)) dispatch({ type: "DELETE_MSG", sessionId: s.id, msgId: m.id });
    setText(q.content);
    if (q.attachments?.length) setAttachments(q.attachments);
    hapticTap();
    return true;
  }, [active, dispatch]);

  // sendText нужен обработчику события end (он объявлен выше) — через ref.
  useEffect(() => { sendTextRef.current = sendText; }, [sendText]);

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
    (m: Msg, x?: number, y?: number) => {
      setMsgMenuTarget(m);
      setMsgMenuAt(x != null && y != null ? { x, y } : null);
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
    setDrawerOpen(false);
    setText("");
    if (sid === active?.id) return;
    // Ответ на тап — в этом же кадре: знак уже на экране. Сама смена сессии
    // (рендер сотен сообщений) уходит на следующий кадр и идёт ПОД лоадером.
    switchInstant.current = true;
    setSwitchOn(true);
    switchFade.setValue(1);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setActive(sid));
    });
  }, [setActive, active?.id, switchFade]);

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
    // Токены приходят десятками в секунду. Раньше каждый токен перерисовывал
    // весь чат (и все markdown-блоки) — кнопки переставали отвечать. Теперь
    // экран обновляется не чаще ~18 раз в секунду, а хвост добирается таймером.
    let lastTokAt = 0;
    let tokTimer: ReturnType<typeof setTimeout> | null = null;
    const flushTok = () => {
      if (getRun(sid).stop) return;
      dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { content: acc } });
      scrollBottom();
    };
    const ctrl = new AbortController();
    getRun(sid).ctrl = ctrl;
    await streamChat(model, history, {
      onToken: (tok) => {
        if (getRun(sid).stop) return;
        acc += tok;
        const now = Date.now();
        if (now - lastTokAt >= 55) {
          lastTokAt = now;
          flushTok();
        } else if (!tokTimer) {
          tokTimer = setTimeout(() => {
            tokTimer = null;
            lastTokAt = Date.now();
            flushTok();
          }, 55);
        }
      },
      onThinking: (thinking) => {
        if (getRun(sid).stop) return;
        if (tokTimer) { clearTimeout(tokTimer); tokTimer = null; }
        dispatch({ type: "UPDATE_MSG", sessionId: sid, msgId: aiId, patch: { thinking } });
      },
      onDone: (clean) => {
        if (tokTimer) { clearTimeout(tokTimer); tokTimer = null; }
        markStreaming(sid, false);
        if (getRun(sid).stop && !clean) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { content: clean || acc || (getRun(sid).stop ? "" : "(пусто)"), streaming: false },
        });
      },
      onError: (err) => {
        if (tokTimer) { clearTimeout(tokTimer); tokTimer = null; }
        markStreaming(sid, false);
        if (getRun(sid).stop) return;
        dispatch({
          type: "UPDATE_MSG", sessionId: sid, msgId: aiId,
          patch: { streaming: false, content: acc || "" },
        });
        showError(err);
      },
    }, ctrl.signal, { maxTokens: prefs.ctx, reasoning: prefs.reasoning });
  }, [active, editTarget, editValue, model, dispatch, scrollBottom, prefs.ctx, prefs.reasoning]);

  const confirmRename = useCallback(() => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (name) {
      dispatch({ type: "UPDATE_SESSION", sessionId: renameTarget.id, patch: { name, titleEdited: true } });
      showToast("ok", "Сессия переименована");
    }
    setRenameTarget(null);
  }, [renameTarget, renameValue, dispatch]);

  const sessionList = [...state.sessions]
    .sort((a, b) => {
      // закреплённые — всегда сверху, дальше по времени изменения
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
    .filter((s) => !search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()));
  // Сессии кронов живут отдельным разделом: они не смешиваются с ручными чатами.
  const chatSessions = sessionList.filter((s) => !s.cron);
  const cronSessions = sessionList.filter((s) => !!s.cron);

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
        {/* Плавное затемнение сверху: сплошной фон под кнопками, ниже мягкий
            переход. Настоящий градиент — 1px-полоски давали ступеньки. */}
        {/* Плавное затемнение шапки: полка под кнопками и длинный спад
            120 px. Чем длиннее спад, тем мельче шаг альфы — на облачках и
            таблицах он не читается полосой. */}
        <LinearGradient
          pointerEvents="none"
          colors={fadeStops(theme.bg)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: 44 }}
        />
        <View
          pointerEvents="box-none"
          style={{
            flexDirection: "row", alignItems: "center",
            backgroundColor: "transparent",
            paddingHorizontal: 12, paddingTop: insets.top + 4, paddingBottom: 2,
          }}
        >
          <Pressable
            onPressIn={() => setDrawerOpen(true)}
            hitSlop={6}
            accessibilityLabel={t("sessions")}
            style={({ pressed }) => ({
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: pressed ? theme.surface2 : theme.surface,
              alignItems: "center", justifyContent: "center",
            })}
          >
            <AppIcon name="menu" size={19} strokeWidth={2.2} color={theme.text} />
          </Pressable>
          <View pointerEvents="box-none" style={{ flex: 1 }} />
          <Reanimated.View ref={chipRef as any} collapsable={false} onLayout={measureChip} style={chipStyle}>
            <BgIndicator theme={theme} count={bgCount} onPress={openBg} />
          </Reanimated.View>
          {/* Выбор модели — справа, габариты как у бургера: высота touchTarget, капсула. */}
          <View onLayout={measurePill} style={{ opacity: modelPickerOpen ? 0 : 1 }}>
          <Pressable
            ref={pillRef as any}
            onLayout={measurePill}
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityLabel="Модель"
            hitSlop={{ top: 2, bottom: 2 }}
            style={({ pressed }) => ({
              height: 40,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 14,
              borderRadius: 26,
              backgroundColor: modelPickerOpen ? theme.surface2 : pressed ? theme.surface2 : theme.surface,
            })}
          >
            <View style={{ width: 5, height: 5, borderRadius: 2, backgroundColor: theme.text }} />
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13.5, fontFamily: fonts.sansDemi, maxWidth: 132 }}>{modelName}</Text>
            <AppIcon name="chevron-down" size={13} color={theme.dim} />
          </Pressable>
          </View>
        </View>

      </View>

      {/* шторка фоновых процессов — только когда есть запущенные (рантайм/cron/делегация).
          Состояние стриминга видно по кнопке в капсуле внизу, там же стоп. */}
      {/* окно фоновых процессов: чип растёт в панель на своём месте */}
      <BgTasksPopover
        open={bgOpen}
        tasks={bgTasks}
        theme={theme}
        anchor={chipBox}
        screenW={screenW}
        progress={bgProg}
        onClose={closeBg}
        onStopAll={() => {
          void (async () => {
            const { stopBg } = await import("../core/background");
            const failed: string[] = [];
            for (const t of bgTasks) {
              if (t.kind === "stream") continue;
              let ok = false;
              try {
                ok = await stopBg(t.kind, t.id);
              } catch {
                ok = false;
              }
              if (!ok) failed.push(t.label);
            }
            // из списка убираем только реально остановленные — иначе кнопка
            // «остановить» просто чистит список, а процесс продолжает жить
            setBgTasks((p) =>
              p.filter((t) => t.kind === "stream" || failed.includes(t.label)),
            );
            if (failed.length) showToast("err", `Не удалось остановить: ${failed.slice(0, 2).join(", ")}`);
          })();
        }}
        onStop={(task) => {
          void (async () => {
            const { stopBg } = await import("../core/background");
            let ok = false;
            try {
              ok = await stopBg(task.kind, task.id);
            } catch {
              ok = false;
            }
            if (!ok) {
              showToast("err", "Не удалось остановить — задача уже завершилась");
              return;
            }
            setBgTasks((p) => p.filter((t) => t.id !== task.id));
          })();
        }}
        onOpen={() => {
          // детали показываем внутри окна: переход на другой экран по клику
          // выглядел как «нажал — и всё пропало»
        }}
      />

      {/* messages — контент скроллится ПОД плавающей шапкой */}
      {(!active || active.messages.length === 0) ? (
        <EmptyChat theme={theme} topInset={insets.top} />
      ) : (
        <Animated.View style={{ flex: 1, opacity: listFade }}>
        <FlatList<Group>
          ref={listRef}
          style={{ flex: 1 }}
          // Android: без этого горизонтальные жесты внутри ячеек (таблицы)
          // забирает вертикальный список.
          nestedScrollEnabled
          data={chainGroups}
          keyExtractor={(g) => g.id}
          ListFooterComponent={
            waitingFirst ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", paddingTop: 10, paddingLeft: 2 }}
                accessibilityLabel="Агент думает"
              >
                <View style={{ marginRight: 9 }}>
                  <ApertureSpin size={22} color={theme.text} cycle={1080} min={0.14} />
                </View>
                <WaitLabel active={waitingFirst} />
              </View>
            ) : null
          }
          /* paddingBottom — только воздух: капсула стоит в потоке ниже списка,
             поэтому прежний composerH + 24 давал пустую полосу над капсулой. */
          removeClippedSubviews={false}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={40}
          windowSize={7}
          contentContainerStyle={{
            padding: 16,
            paddingTop: insets.top + 96,
            // капсула ввода плавает поверх списка: оставляем ровно её высоту,
            // чтобы последнее сообщение можно было доскроллить над капсулой
            paddingBottom: compPadBottom + 80,
          }}
          onLayout={(e) => {
            listH.current = e.nativeEvent.layout.height;
          }}
          onContentSizeChange={(_w, hgt) => {
            contentH.current = hgt;
            if (!listReady) {
              listRef.current?.scrollToEnd({ animated: false });
              setListReady(true);
            } else {
              stickBottom();
            }
          }}
          onScrollBeginDrag={() => {
            if (stickTimer.current) { clearTimeout(stickTimer.current); stickTimer.current = null; }
          }}
          onScroll={(e) => {
            listOffsetY.current = e.nativeEvent.contentOffset.y;
            if (Date.now() < progUntil.current) return; // это наша прокрутка, не пользователь
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            // «у низа» = меньше 64px до кромки: тогда новые сообщения сами
            // подтягивают чат; выше — листаем спокойно и не дёргается
            const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
            const near = dist <= 64;
            atBottom.current = near;
            setShowJump((prev) => prev === !near ? prev : !near);
          }}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: g, index }) => (
            <Reanimated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(140)}
              layout={LinearTransition.duration(180)}
              ref={(r: any) => {
                const id = g.kind === "chain" ? g.msgs[g.msgs.length - 1]?.id : g.msg?.id;
                if (id) rowRefs.current[id] = r;
              }}
              onLayout={(e) => {
                const id = g.kind === "chain" ? g.msgs[g.msgs.length - 1]?.id : g.msg?.id;
                if (id) rowY.current[id] = e.nativeEvent.layout.y;
              }}
            >
            <MsgRow
              g={g}
              sig={groupSig(g)}
              isLast={index === chainGroups.length - 1}
              theme={theme}
              onDetail={setDetailTarget}
              onCopy={copyMsg}
              onShare={shareMsg}
              onEdit={startEdit}
              onLongPress={msgMenu}
              onRetry={retrySend}
            />
            </Reanimated.View>
          )}
        />
        </Animated.View>
      )}

      {/* streaming-индикатор намеренно убран: ни «обрабатываю запрос…», ни точек —
          пользователь попросил чистый чат. Раздумья видны в блоке ThinkingBlock. */}

      {/* переключение сессии: знак по центру, фон не затемняем */}
      {switchOn ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            alignItems: "center", justifyContent: "center", opacity: switchFade,
          }}
        >
          <ApertureSpin size={30} color={theme.text} cycle={1080} min={0.14} />
        </Animated.View>
      ) : null}

      {/* кнопка «в самый низ» — появляется, когда пролистали вверх */}
      <Animated.View
        pointerEvents={showJump ? "auto" : "none"}
        style={{
          position: "absolute", right: 16,
          // над капсулой и над полосой вложений: composerH растёт — кнопка едет
          // вверх вместе с ней, а zIndex/elevation держат её поверх ввода
          bottom: attachOpen || attachments.length > 0 ? Math.max(composerH, 76) + 10 : compPadBottom + 92,
          zIndex: 60,
          elevation: 20,
          opacity: jumpAnim,
          transform: [
            { translateY: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            { scale: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        }}
      >
        <Pressable
          onPress={() => {
            doScrollEnd(true);
            // прячем по факту: если не доехали — onScroll покажет кнопку снова
            setTimeout(() => setShowJump(false), 140);
          }}
          accessibilityRole="button"
          accessibilityLabel="В самый низ"
          style={({ pressed }) => ({
            width: 44, height: 44, borderRadius: 22,
            alignItems: "center", justifyContent: "center",
            backgroundColor: pressed ? theme.userBubble : theme.surface2,
          })}
        >
          <AppIcon name="chevron-down" size={20} color={theme.text} />
        </Pressable>
      </Animated.View>


      {/* input.
        Android: капсулу поднимаем вручную через kbH (Keyboard listeners выше) —
        манифестный adjustResize не двигает плавающую капсулу при edge-to-edge.
        iOS: KAV с behavior="padding" сдвигает панель. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        pointerEvents="box-none"
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          backgroundColor: "transparent",
        }}
      >
        {/* Низ больше не затемняется целиком: остаётся только узкая полоса
            у самой кромки экрана — она гасит переписку под капсулой и не
            съедает читаемую зону над ней. */}
        <LinearGradient
          pointerEvents="none"
          colors={fadeStopsDown(theme.bg)}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            height: 44,
          }}
        />
        <View
          pointerEvents="box-none"
          onLayout={(e) => setComposerH(Math.round(e.nativeEvent.layout.height))}
          style={{
            backgroundColor: "transparent",
            paddingHorizontal: 20,
            paddingBottom: compPadBottom,
          }}
        >
          <Reanimated.View collapsable={false} style={[{ position: "relative" }, attachLift]}>
            {/* Полоса 104 px над капсулой: лента живёт в обычном потоке (листается
                вбок) и уезжает вверх ВМЕСТЕ с капсулой — раньше при открытой панели
                вложения оставались под ней. */}
            <View style={{ height: 104, justifyContent: "flex-end" }}>
              <Reanimated.View pointerEvents={attachments.length > 0 ? "auto" : "none"} style={stripStyle}>
                {stripMounted ? (
                  <AttachmentStrip
                    items={attachments}
                    theme={theme}
                    onRemove={(i) => setAttachments((prev) => prev.filter((_, k) => k !== i))}
                  />
                ) : null}
              </Reanimated.View>
            </View>
                      {/* капсула ввода: #141416, радиус 26, без стекла и градиентов */}
          <Glass
            radius={25}
            border={false}
            style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 8 }}
          >
            {/* во время диктовки слева не остаётся ничего: кнопка сжимается
                в ноль, линия начинается от самой кромки капсулы */}
            <Reanimated.View style={[{ flexShrink: 0 }, leftStyle]}>
            <Pressable
              disabled={recording}
              onPress={() => {
                const next = !attachOpen;
                hapticTap();
                setAttachOpen(next);
                attachProg.value = withTiming(next ? 1 : 0, {
                  duration: next ? 260 : 200,
                  easing: next ? REasing.out(REasing.cubic) : REasing.in(REasing.cubic),
                });
              }}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityLabel="Прикрепить"
            >
              {/* плюс поворачивается на 45° и растворяется — на его месте
                  крест из того же центра, уже красный */}
              <Reanimated.View style={[{ position: "absolute" }, plusIconStyle]}>
                <AppIcon name="plus" size={22} color={theme.text} />
              </Reanimated.View>
              <Reanimated.View style={[{ position: "absolute" }, closeIconStyle]}>
                <AppIcon name="close" size={22} color={theme.danger} />
              </Reanimated.View>
            </Pressable>
            </Reanimated.View>
            {/* поле; на время диктовки текст невидим — поверх идёт линия уровня */}
            <View style={{ flex: 1 }}>
            <TextInput
              value={recording ? "" : text}
              caretHidden={recording}
              underlineColorAndroid="transparent"
              /* тап по полю не должен выбрасывать из прочитанного места в самый низ */
              onChangeText={(v) => {
                // если пользователь правит текст руками во время диктовки —
                // дальше распознанное дописывается к НОВОМУ тексту, а не затирает его
                if (!sttWriting.current) sttBase.current = v;
                setText(v);
              }}
              placeholder={recording ? "" : t("message_placeholder")}
              placeholderTextColor={theme.mute}
              multiline
              textAlignVertical="center"
              style={{
                flex: 1, fontSize: 14, backgroundColor: "transparent",
                color: recording ? "transparent" : theme.text,
                fontFamily: fonts.sansMedium,
                textAlignVertical: "center",
                // web: textarea не центрирует текст вертикально — задаём высоту и паддинги,
                // чтобы строка (20px) стояла ровно по центру поля 44
                ...(Platform.OS === "web"
                  ? { height: 44, lineHeight: 20, paddingTop: 12, paddingBottom: 12, maxHeight: undefined }
                  : { minHeight: 44, maxHeight: 120, paddingVertical: 0, lineHeight: 20 }),
              }}
            />
            {recording ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <RecWave api={waveApi} color={theme.text} />
              </View>
            ) : null}
            </View>
            {recording ? <RecTimer color={theme.mute} fontFamily={fonts.mono} /> : null}
            {/* правая группа: действие + live. Появление и исчезновение — фейд
                с плавным изменением ширины, а не щелчок на ровном месте. */}
            <Reanimated.View
              layout={LinearTransition.duration(180)}
              style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}
            >
            <Reanimated.View
              key={isStreaming(active?.id) ? "stop" : !recording && text.trim() ? "send" : "mic"}
              entering={FadeIn.duration(130)}
              exiting={FadeOut.duration(100)}
              layout={LinearTransition.duration(180)}
            >
            {isStreaming(active?.id) ? (
              <Pressable
                onPressIn={() => {
                  const s = active?.id;
                  if (!s) return;
                  // 1) останавливаем транспорт, 2) сразу возвращаем капсулу в
                  // обычное состояние, 3) закрываем «печатающие» пузыри: текст,
                  // который модель успела выдать, остаётся в чате.
                  getRun(s).stop = true;
                  getRun(s).ctrl?.abort();
                  markStreaming(s, false);
                  cancelTurn();
                  dispatch({ type: "STOP_SESSION_STREAM", sessionId: s });
                }}
                // Спокойная кнопка вместо красного круга: нейтральный фон
                // капсулы и единственная красная точка — квадрат стопа.
                style={({ pressed }) => ({
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: pressed ? theme.surface2 : theme.surface,
                  alignItems: "center", justifyContent: "center",
                })}
                accessibilityLabel="Остановить"
              >
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: theme.danger }} />
              </Pressable>
            ) : !recording && text.trim() ? (
              <Pressable
                onPressIn={send}
                hitSlop={8}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Отправить"
              >
                <AppIcon name="send" size={18} color={theme.onAccent} />
              </Pressable>
            ) : (
              <Pressable
                onPressIn={onMicPressIn}
                onPress={onMicPress}
                onLongPress={onMicLongPress}
                onPressOut={onMicPressOut}
                delayLongPress={300}
                hitSlop={6}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
                accessibilityLabel="Голосовой ввод"
              >
                {/* кольцо окутывает кнопку и пульсирует под голос */}
                {recording ? (
                  <Reanimated.View
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute", width: 58, height: 58, borderRadius: 29,
                        borderWidth: 1.5, borderColor: theme.text,
                      },
                      ringStyle,
                    ]}
                  />
                ) : null}
                <AppIcon name="mic" size={22} strokeWidth={2.2} color={recording ? theme.danger : theme.text} />
              </Pressable>
            )}
            </Reanimated.View>
            {/* Live-режим: справа от микрофона. Как только в поле появился
                текст — голос и live убираются целиком, а отправка встаёт
                на место live, в самый правый слот капсулы. */}
            {!text.trim() && !isStreaming(active?.id) ? (
            <Reanimated.View
              entering={FadeIn.duration(130)}
              exiting={FadeOut.duration(100)}
              layout={LinearTransition.duration(180)}
            >
            <Pressable
              disabled={recording}
              onPress={() => {
                hapticTap();
                showToast("info", "Live-режим — скоро");
              }}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22,
                alignItems: "center", justifyContent: "center",
                opacity: recording ? 0.3 : pressed ? 0.55 : 1,
              })}
              accessibilityLabel="Live-режим"
            >
              <AppIcon name="live" size={22} color={theme.text} />
            </Pressable>
            </Reanimated.View>
            ) : null}
            </Reanimated.View>
          </Glass>
          </Reanimated.View>

          {/* Панель «прикрепить»: висит под капсулой абсолютно, высота не анимируется —
              связка уезжает вверх transform'ом, поэтому layout не пересчитывается.
              Плитки 92, между ними пусто: переписка просвечивает. */}
          <Reanimated.View
            pointerEvents={attachOpen ? "auto" : "none"}
            collapsable={false}
            style={{
              position: "absolute", left: 20, right: 20, bottom: compPadBottom,
              height: 110, paddingTop: 10, zIndex: 3,
            }}
          >
            <Reanimated.View
              style={[{ flexDirection: "row", gap: 10 }, attachPanelStyle]}
            >
              {[
                { icon: "camera" as const, label: "Камера", onPress: pickCamera },
                { icon: "image" as const, label: "Альбом", onPress: pickImage },
                { icon: "file" as const, label: "Файл", onPress: pickFile },
              ].map((b) => (
                <Pressable
                  key={b.label}
                  onPress={() => {
                    hapticTap();
                    closeAttach();
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
            </Reanimated.View>
          </Reanimated.View>
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
        sessions={chatSessions}
        streaming={liveSessions}
        cronSessions={cronSessions}
        onSessionMenu={(s: Session, p?: { x: number; y: number }) => { setSessionMenuPoint(p ?? null); setSessionMenuTarget(s); }}
        onPin={(s) => {
          dispatch({ type: "UPDATE_SESSION", sessionId: s.id, patch: { pinned: !s.pinned } });
          showToast("ok", s.pinned ? "Откреплено" : "Закреплено");
        }}
        activeId={active?.id ?? null}
        onSelectSession={openDrawerSession}
        search={search}
        onSearchChange={setSearch}
        onRename={renameSessionById}
        onDelete={deleteSessionById}
      />




      {/* ── Выбор модели: окно растёт вверх на месте кнопки, без шторки снизу ── */}
      <ModelPickerPopover
        progress={pickerProg}
        open={modelPickerOpen}
        models={allModels.map((m) => ({
          modelName: m.modelName,
          providerName: (m as any).providerName ?? m.providerId,
          displayName: m.displayName,
        }))}
        current={model?.modelName}
        onSelect={(m: any) => {
          const found = allModels.find((x) => x.modelName === m.modelName);
          if (found) switchModel(found);
          setModelPickerOpen(false);
        }}
        onClose={() => setModelPickerOpen(false)}
        theme={theme}
        anchor={pillBox}
        screenW={screenW}
        prefs={prefs}
        onPrefs={applyPrefs}
        onAdd={() => {
          setModelPickerOpen(false);
          navigation.navigate("Providers");
        }}
      />

      {/* ── Действия с сообщением — маленькое окно у места удержания ── */}
      <MsgMenu
        target={msgMenuTarget}
        at={msgMenuAt}
        visible={!!msgMenuTarget}
        onClose={() => setMsgMenuTarget(null)}
        onRetry={(m) => { retryMsg(m); setMsgMenuTarget(null); }}
        onCopy={(m) => { copyMsg(m); setMsgMenuTarget(null); }}
        onShare={(m) => { shareMsg(m); setMsgMenuTarget(null); }}
        onDelete={(m) => { doDeleteMsg(m); setMsgMenuTarget(null); }}
        onEdit={(m) => { startEdit(m); setMsgMenuTarget(null); }}
      />

      {/* ── Детали команды/раздумий — bottom-sheet как окно сессии ── */}
      <Sheet visible={!!detailTarget} onClose={() => setDetailTarget(null)} title={detailTarget?.tool ? "Ход выполнения" : "Думаю"} snapPoints={["auto"]} autoMaxPct={60}>
        {detailTarget && (
          <>
            {detailTarget.tool ? (
              <Text selectable style={{ color: theme.text, fontSize: 12.5, fontFamily: fonts.mono, backgroundColor: theme.surface2, borderRadius: 20, padding: 12, lineHeight: 19 }}>
                {detailTarget.tool.trim()}
                {detailTarget.toolOutput ? `\n\n${detailTarget.toolOutput.trim()}` : ""}
              </Text>
            ) : null}
            {detailTarget.thinking ? (
              <Text selectable style={{ color: theme.dim, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 19 }}>
                {inlineFormulaText(detailTarget.thinking.trim())}
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
      {/* ── Действия с сессией: мини-окно по долгому нажатию в панели ── */}
      {/* ── Мини-меню сессии — у места нажатия (long-press), не шторка снизу ── */}
      <Modal
        visible={!!sessionMenuTarget}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { setSessionMenuTarget(null); setSessionMenuPoint(null); }}
      >
        {!!sessionMenuTarget && (
        <>
          <Pressable
            onPress={() => { setSessionMenuTarget(null); setSessionMenuPoint(null); }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}
            accessibilityLabel="Закрыть меню"
          />
          {(() => {
            const win = Dimensions.get("window");
            const W = 196, ROW = 48, H = ROW * 3 + 8;
            const px = sessionMenuPoint?.x ?? win.width / 2;
            const py = sessionMenuPoint?.y ?? win.height / 2;
            const left = Math.min(Math.max(12, px - W / 2), win.width - W - 12);
            const top = Math.min(Math.max(insets.top + 12, py - H - 12), win.height - H - (insets.bottom + 12));
            const rows = [
              {
                key: "rename",
                icon: "pen" as const,
                label: "Редактировать",
                color: theme.text,
                onPress: () => {
                  const t = sessionMenuTarget;
                  setSessionMenuTarget(null); setSessionMenuPoint(null);
                  setRenameValue(t.name);
                  setRenameTarget(t);
                },
              },
              {
                key: "pin",
                icon: "pin" as const,
                label: sessionMenuTarget.pinned ? "Открепить" : "Прикрепить",
                color: theme.text,
                onPress: () => {
                  const t = sessionMenuTarget;
                  dispatch({ type: "UPDATE_SESSION", sessionId: t.id, patch: { pinned: !t.pinned } });
                  showToast("ok", t.pinned ? "Откреплено" : "Закреплено");
                  setSessionMenuTarget(null); setSessionMenuPoint(null);
                },
              },
              {
                key: "delete",
                icon: "delete" as const,
                label: "Удалить",
                color: theme.danger,
                onPress: () => {
                  const t = sessionMenuTarget;
                  setSessionMenuTarget(null); setSessionMenuPoint(null);
                  setDeleteTarget(t);
                },
              },
            ];
            return (
              <View
                style={{
                  position: "absolute", left, top, width: W, zIndex: 61,
                  backgroundColor: theme.surface2, borderRadius: 20, paddingVertical: 4,
                }}
              >
                {rows.map((row, i) => (
                  <Pressable
                    key={row.key}
                    onPress={row.onPress}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", gap: 12,
                      height: ROW, paddingHorizontal: 16, borderRadius: 16, marginHorizontal: 4,
                      backgroundColor: pressed ? theme.surface : "transparent",
                    })}
                  >
                    <AppIcon name={row.icon} color={row.color} size={18} />
                    <Text style={{ color: row.color, fontSize: 15.5, fontWeight: "500" }}>{row.label}</Text>
                  </Pressable>
                ))}
              </View>
            );
          })()}
        </>
        )}
      </Modal>

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
/**
 * Линия диктовки — вариант A, «гребёнка».
 *
 * Слева ничего нет: первые столбики появляются у ПРАВОЙ кромки и с каждым
 * новым отсчётом дорожка удлиняется влево, пока не упрётся в левый край —
 * тогда старые столбики уходят за кромку и тают.
 *
 * Никакого зигзага «плюс-минус» по сырому rms (он и дрожал от шума):
 * уровень проходит шумовой порог и сглаживается с разной скоростью на
 * подъём и спад, поэтому в тишине линия ровная.
 */
function RecWave({ api, color }: { api: React.MutableRefObject<((v: number) => void) | null>; color: string }) {
  const [path, setPath] = useState("");
  const buf = useRef<number[]>([]);
  const last = useRef(0);
  const sm = useRef(0);
  const peak = useRef(0.18);
  const inn = useSharedValue(0);

  useEffect(() => {
    inn.value = withTiming(1, { duration: 120, easing: REasing.out(REasing.cubic) });
  }, [inn]);
  const st = useAnimatedStyle(() => ({ opacity: inn.value }));

  const push = useCallback((v: number) => {
    const now = Date.now();
    if (now - last.current < 30) return; // ~33 кадра в секунду — дорожка бежит живее
    last.current = now;

    let raw = Math.max(0, Math.min(1, (v + 2) / 12));
    if (raw < 0.06) raw = 0; // шумовой порог: тишина остаётся тишиной
    // На громком голосе сырой уровень упирался в 1 и все столбики замирали
    // одной высотой. Держим плавающий пик и нормируем по нему — рисунок
    // продолжает двигаться даже на крике.
    peak.current = Math.max(raw, peak.current * 0.975, 0.18);
    const rel = Math.min(1, raw / peak.current);
    const k = rel > sm.current ? 0.45 : 0.22;
    sm.current = sm.current + (rel - sm.current) * k;

    buf.current.push(sm.current);
    if (buf.current.length > MAX_BARS) buf.current.shift();

    // столбики прижаты вправо: первый — у кромки, новые удлиняют дорожку влево
    const n = buf.current.length;
    const d: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const v0 = buf.current[n - 1 - i];   // i=0 — самый свежий, он справа
      const x = 100 - i * BAR_STEP;
      const h = Math.max(3, 3 + v0 * 30);
      d.push(`M${x.toFixed(2)} ${(22 - h / 2).toFixed(1)} V${(22 + h / 2).toFixed(1)}`);
    }
    setPath(d.join(" "));
  }, []);

  useEffect(() => {
    api.current = push;
    return () => { api.current = null; };
  }, [api, push]);

  // новая запись — с чистого листа, ничего «уже нарисованного»
  useEffect(() => {
    buf.current = [];
    sm.current = 0;
    setPath("");
  }, [api]);

  return (
    <Reanimated.View style={[StyleSheet.absoluteFill, st]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 44" preserveAspectRatio="none">
        <Defs>
          {/* хвост тает у левой кромки, а не обрывается */}
          <SvgGradient id="recFade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#141416" stopOpacity="1" />
            <Stop offset="0.55" stopColor="#141416" stopOpacity="0.7" />
            <Stop offset="1" stopColor="#141416" stopOpacity="0" />
          </SvgGradient>
        </Defs>
        <SvgPath d={path} stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        <SvgRect x={0} y={0} width={9} height={44} fill="url(#recFade)" />
      </Svg>
    </Reanimated.View>
  );
}

const MAX_BARS = 56;   // 56 столбиков × 1.80 = вся ширина капсулы
const BAR_STEP = 1.80; // шаг в единицах viewBox 0..100

function fileIconName(name?: string): AppIconName {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst"].includes(ext)) return "box";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "ods", "odp", "csv"].includes(ext)) return "file";
  return "file";
}


function Bubble({ msg, theme, onCopy, onShare, onEdit, onLongPress, showActions, onOpenDetail, retry }: { msg: Msg; theme: any; onCopy: () => void; onShare: () => void; onEdit?: () => void; onLongPress?: (e?: any) => void; showActions?: boolean; onOpenDetail?: (m: Msg) => void; retry?: React.ReactNode }) {
  const user = msg.role === "user";
  const align: "flex-end" | "flex-start" = user ? "flex-end" : "flex-start";
  // Kimi: юзер — синяя капсула справа; ассистент — БЕЗ рамки, чистый текст слева
  // Ширина в пикселях, а не в процентах: процент пересчитывается при каждом
  // перестроении списка, и короткое облачко «прыгало» в ширине, когда ниже
  // появлялось новое сообщение. Пиксельная ширина от окна стабильна.
  const winW = useWindowDimensions().width;
  // alignItems для юзера: без него ряд иконок под облачком (132 px) растягивал
  // контейнер, и короткое облачко получало пустое место слева. После отправки
  // следующего сообщения иконки уезжали — облачко «схлопывалось» в ширине.
  const containerStyle = {
    alignSelf: align,
    alignItems: user ? ("flex-end" as const) : ("stretch" as const),
    maxWidth: user ? Math.round(winW * 0.86) : winW,
    marginBottom: 10,
  };
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
  // Пустая карточка (ни текста, ни раздумий, ни инструмента) — не рисуем:
  // думалка, из которой взяли ответ, гасится в gateway и остаётся пустой.
  if (!msg.content && !msg.thinking && !msg.tool && !msg.error) {
    return null;
  }
  // Старые сообщения с ошибкой в тексте: сама ошибка больше не рисуется —
  // их показывала плашка, когда они случились.
  if (msg.error && !msg.content) return null;
  return (
    <View style={containerStyle}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
      {user ? (
        // юзер: синяя капсула (KMBlue), белый текст, радиус 20.
        // Кнопку повтора держим В ЭТОМ ЖЕ ряду: иначе она привязывается к
        // контейнеру, а он шире короткого облачка (ряд иконок под ним) — и для
        // сообщений вроде «ауу» кнопка улетала далеко влево.
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end" }}>
          {retry ? <View style={{ marginRight: 6, marginTop: 6 }}>{retry}</View> : null}
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

/** Подпись группы для memo: перерисовываем ряд только если поменялся смысл. */
function groupSig(g: any): string {
  if (g.kind === "chain") {
    return "c:" + g.msgs.map((m: any) => `${m.id}:${(m.thinking || "").length}:${m.tool || ""}:${m.toolState || ""}:${(m.toolOutput || "").length}`).join(",");
  }
  const m = g.msg;
  return `b:${m.id}:${(m.content || "").length}:${m.streaming ? 1 : 0}:${(m.thinking || "").length}:${m.error ? 1 : 0}:${(m.image ? 1 : 0)}:${m.failed ? 1 : 0}`;
}

/**
 * Один ряд чата. Мемоизирован: во время стрима каждый токен создаёт новые
 * объекты групп, но перерисовывается только ряд, у которого изменился текст.
 * Без этого каждый токен перерисовывал весь чат и кнопки отвечали через секунду.
 */
const MsgRow = React.memo(
  function MsgRow({
    g, isLast, theme, onDetail, onCopy, onShare, onEdit, onLongPress, onRetry,
  }: {
    g: any; sig: string; isLast: boolean; theme: any;
    onDetail: (m: Msg) => void;
    onCopy: (m: Msg) => void; onShare: (m: Msg) => void;
    onEdit: (m: Msg) => void; onLongPress: (m: Msg, x?: number, y?: number) => void;
    onRetry?: (m: Msg) => void;
  }) {
    if (g.kind === "chain") {
      const chainText = g.msgs.filter((m: any) => m.thinking).map((m: any) => String(m.thinking)).join("\n\n");
      const chainTools = g.msgs.filter((m: any) => m.tool);
      const anyStreaming = g.msgs.some((m: any) => m.streaming);
      const firstThink = g.msgs.find((m: any) => m.thinking);
      return (
        <View style={{ width: "94%", alignSelf: "flex-start", marginBottom: 10 }}>
          <View style={{ width: "100%", paddingLeft: 4, paddingRight: 4 }}>
            {chainText ? (
              <ThinkingBlock
                text={chainText}
                status={anyStreaming ? "thinking" : "done"}
                theme={theme}
                onOpen={() => firstThink && onDetail(firstThink)}
                bare
              />
            ) : null}
            {chainTools.map((m: any) => (
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
          </View>
        </View>
      );
    }
    const msg = g.msg;
    const showActions = isLast && !msg.tool;
    const retry = msg.role === "user" && msg.failed && onRetry ? (
      <Reanimated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
        <Pressable
          onPress={() => onRetry(msg)}
          hitSlop={8}
          accessibilityLabel="Повторить отправку"
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.danger, alignItems: "center", justifyContent: "center" }}
        >
          <AppIcon name="refresh" size={16} strokeWidth={2.2} color="#fff" />
        </Pressable>
      </Reanimated.View>
    ) : null;
    const bubble = (
      <Bubble
        msg={msg}
        theme={theme}
        onCopy={() => onCopy(msg)}
        onShare={() => onShare(msg)}
        onEdit={() => onEdit(msg)}
        onLongPress={(e: any) => onLongPress(msg, e?.nativeEvent?.pageX, e?.nativeEvent?.pageY)}
        showActions={showActions}
        onOpenDetail={onDetail}
        retry={retry}
      />
    );
    // Кнопка повтора живёт внутри Bubble, вплотную к капсуле: внешняя обёртка
    // давала лишнюю ширину контейнеру и отрывала кнопку от коротких сообщений.
    return bubble;
  },
  (a, b) => a.sig === b.sig && a.isLast === b.isLast && a.theme === b.theme,
);

/**
 * Маленькое окно действий по сообщению — всплывает у места удержания,
 * а не снизу. У краёв экрана разворачивается внутрь и вверх.
 */
const MENU_W = 208;
const MENU_ROW = 44;
const MENU_PAD = 6;

function MsgMenu({
  target, at, visible, onClose, onRetry, onCopy, onShare, onDelete, onEdit,
}: {
  target: Msg | null;
  at: { x: number; y: number } | null;
  visible: boolean;
  onClose: () => void;
  onRetry: (m: Msg) => void;
  onCopy: (m: Msg) => void;
  onShare: (m: Msg) => void;
  onDelete: (m: Msg) => void;
  onEdit: (m: Msg) => void;
}) {
  const { theme } = useApp();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;
  // Окно остаётся смонтированным, пока идёт анимация ухода: раньше `return null`
  // на закрытии выдёргивал его из дерева, и оно исчезало рывком.
  const [shown, setShown] = useState<Msg | null>(null);

  useEffect(() => {
    if (target) setShown(target);
  }, [target]);

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 180,
      easing: visible ? Easing.bezier(0.16, 0.84, 0.24, 1) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setShown(null);
    });
  }, [visible, a]);

  const m = shown ?? target;
  if (!m) return null;

  const canEdit = m.role === "user";
  const canRetry = m.role === "assistant" && (!!m.content || !!m.error);
  const rows = [
    ...(canEdit ? [{ key: "edit", label: "Изменить", icon: "edit" as AppIconName, danger: false }] : []),
    ...(canRetry ? [{ key: "retry", label: "Повторить", icon: "refresh" as AppIconName, danger: false }] : []),
    { key: "copy", label: "Копировать", icon: "copy" as AppIconName, danger: false },
    { key: "share", label: "Поделиться", icon: "share" as AppIconName, danger: false },
    { key: "del", label: "Удалить", icon: "delete" as AppIconName, danger: true },
  ];
  const menuH = rows.length * MENU_ROW + MENU_PAD * 2;

  const px = at?.x ?? W / 2;
  const py = at?.y ?? H / 2;
  const left = Math.min(Math.max(10, px - MENU_W / 2), W - MENU_W - 10);
  const below = py + menuH + 24 < H - insets.bottom;
  const top = below ? py + 10 : Math.max(insets.top + 10, py - menuH - 10);
  // растём из точки удержания, а не из центра окна
  const ox = Math.min(Math.max(0, px - left), MENU_W);
  const oy = Math.min(Math.max(0, py - top), menuH);

  const act = (key: string) => {
    if (key === "edit") onEdit(m);
    else if (key === "retry") onRetry(m);
    else if (key === "copy") onCopy(m);
    else if (key === "share") onShare(m);
    else onDelete(m);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        style={{
          position: "absolute",
          left,
          top,
          width: MENU_W,
          paddingVertical: MENU_PAD,
          borderRadius: 16,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          shadowColor: "#000",
          shadowOpacity: 0.34,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          elevation: 14,
          transformOrigin: [ox, oy, 0],
          opacity: a,
          transform: [
            { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
            { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [below ? -8 : 8, 0] }) },
          ],
        }}
      >
        {rows.map((r, i) => (
          <Pressable
            key={r.key}
            onPress={() => act(r.key)}
            style={({ pressed }) => ({
              height: MENU_ROW,
              paddingHorizontal: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
              backgroundColor: pressed ? theme.surface2 : "transparent",
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.border,
            })}
          >
            <AppIcon name={r.icon} size={17} color={r.danger ? theme.danger : theme.dim} />
            <Text style={{ color: r.danger ? theme.danger : theme.text, fontSize: 14.5 }}>{r.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}
