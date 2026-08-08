/**
 * Глобальное состояние приложения (Context + useReducer).
 * Хранит: юзера/токен (SecureStore), тему, язык, модели, сессии, сообщения.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Theme, ThemeName, themes } from "../theme/tokens";
import { Lang } from "../i18n";
import { ModelInfo, loadModels } from "../core/gateway";
import { listCustomProviders, providersToModels } from "../core/providers";
import { loadApiBase } from "../core/env";

/* ── Types ─────────────────────────────────────────────── */

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
  /** Поток раздумий (reasoning_content) — как отдельный блок в стиле Kimi. */
  thinking?: string;
  /** Карточка инструмента (терминал/файл/поиск) — как в Kimi. */
  tool?: string;
  toolState?: "loading" | "done" | "error";
  /** Вывод/ход команды или действия агента — раскрывается как раздумья. */
  toolOutput?: string;
  /** Вложение пользователя: URI картинки (галерея/камера). */
  image?: string;
  /** Вложение пользователя: файл. */
  file?: { name: string; uri: string };
}

export interface Session {
  id: string;
  name: string;
  messages: Msg[];
  /** modelName выбранной модели (строка), null = авто */
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Привязка к vibe-проекту: агент знает контекст проекта, файлы пишутся в него. */
  projectId?: string | null;
}

interface State {
  token: string | null;
  profile: {
    username: string | null;
    telegramId: number | null;
    premium: boolean;
    quotaUsed: number;
    quotaLimit: number;
  } | null;
  theme: ThemeName;
  lang: Lang;
  models: ModelInfo[];
  customModels: ModelInfo[];
  sessions: Session[];
  activeSessionId: string | null;
  /** Модель по умолчанию для новых сессий (персистится между запусками). */
  defaultModelId: string | null;
  syncing: boolean;
  syncStatus: string; // idle | pending | done | error
  deviceId: string;
  ready: boolean;
}

type Action =
  | { type: "SET_READY" }
  | { type: "SET_TOKEN"; token: string | null }
  | { type: "SET_PROFILE"; profile: State["profile"] }
  | { type: "SET_THEME"; theme: ThemeName }
  | { type: "SET_LANG"; lang: Lang }
  | { type: "SET_MODELS"; models: ModelInfo[] }
  | { type: "SET_CUSTOM_MODELS"; models: ModelInfo[] }
  | { type: "SET_SYNC"; status: string; syncing?: boolean }
  | { type: "SET_DEVICE"; deviceId: string }
  | { type: "ADD_SESSION"; session: Session }
  | { type: "UPDATE_SESSION"; sessionId: string; patch: Partial<Session> }
  | { type: "SET_SESSIONS"; sessions: Session[] }
  | { type: "SET_ACTIVE"; sessionId: string | null }
  | { type: "SET_DEFAULT_MODEL"; modelId: string | null }
  | { type: "ADD_MSG"; sessionId: string; msg: Msg }
  | { type: "UPDATE_MSG"; sessionId: string; msgId: string; patch: Partial<Msg> }
  | { type: "DELETE_MSG"; sessionId: string; msgId: string }
  | { type: "DELETE_SESSION"; sessionId: string };

function genId(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function genDeviceId(): string {
  // достаточно уникален для устройства; хранится в SecureStore
  return "dev_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
}

const initialState: State = {
  token: null,
  profile: null,
  theme: "dark",
  lang: "ru",
  models: [],
  customModels: [],
  sessions: [],
  activeSessionId: null,
  defaultModelId: null,
  syncing: false,
  syncStatus: "idle",
  deviceId: "",
  ready: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_READY":
      return { ...state, ready: true };
    case "SET_TOKEN":
      return { ...state, token: action.token };
    case "SET_PROFILE":
      return { ...state, profile: action.profile };
    case "SET_THEME":
      return { ...state, theme: action.theme };
    case "SET_LANG":
      return { ...state, lang: action.lang };
    case "SET_MODELS":
      return { ...state, models: action.models };
    case "SET_CUSTOM_MODELS":
      return { ...state, customModels: action.models };
    case "SET_SYNC":
      return { ...state, syncStatus: action.status, syncing: action.syncing ?? state.syncing };
    case "SET_DEVICE":
      return { ...state, deviceId: action.deviceId };
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };
    case "ADD_SESSION":
      return {
        ...state,
        sessions: [action.session, ...state.sessions],
        activeSessionId: action.session.id,
      };
    case "UPDATE_SESSION":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, ...action.patch, updatedAt: Date.now() } : s,
        ),
      };
    case "SET_ACTIVE":
      return { ...state, activeSessionId: action.sessionId };
    case "SET_DEFAULT_MODEL":
      return { ...state, defaultModelId: action.modelId };
    case "ADD_MSG":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId
            ? { ...s, messages: [...s.messages, action.msg], updatedAt: Date.now() }
            : s,
        ),
      };
    case "UPDATE_MSG":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === action.msgId ? { ...m, ...action.patch } : m,
                ),
                updatedAt: Date.now(),
              }
            : s,
        ),
      };
    case "DELETE_MSG":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId
            ? { ...s, messages: s.messages.filter((m) => m.id !== action.msgId), updatedAt: Date.now() }
            : s,
        ),
      };
    case "DELETE_SESSION":
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.sessionId),
        activeSessionId:
          state.activeSessionId === action.sessionId ? null : state.activeSessionId,
      };
    default:
      return state;
  }
}

/* ── Context ───────────────────────────────────────────── */

interface Store {
  state: State;
  theme: Theme;
  dispatch: React.Dispatch<Action>;
  t: (key: Parameters<typeof import("../i18n").t>[1]) => string;
  newSession: () => string;
  setActive: (id: string) => void;
  deleteSession: (id: string) => void;
  setDefaultModel: (modelId: string | null) => void;
  saveState: () => void;
}

const Ctx = createContext<Store | null>(null);

const KEYS = {
  token: "aso_token",
  theme: "aso_theme",
  lang: "aso_lang",
  device: "aso_device",
  sessions: "aso_sessions",
  active: "aso_active",
  defaultModel: "aso_default_model",
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const scheme = useColorScheme();
  // резолвим 'system' в фактическую тему
  const theme = useMemo(() => {
    const resolved: "light" | "dark" =
      state.theme === "system" ? (scheme === "dark" ? "dark" : "light") : state.theme;
    return themes[resolved] ?? themes.dark;
  }, [state.theme, scheme]);

  // ── bootstrap ──
  useEffect(() => {
    (async () => {
      try {
        await loadApiBase();
        // Каждый источник тянем отдельно с catch: на web SecureStore — пустой
        // объект и getItemAsync бросает. Если это роняет Promise.all, сессии
        // не загружаются и persist перетирает их пустым массивом.
        const secureGet = async (k: string) => {
          try { return await SecureStore.getItemAsync(k); } catch { return null; }
        };
        const [tok, th, lg, dev, sessRaw, activeRaw, defModelRaw] = await Promise.all([
          secureGet(KEYS.token),
          AsyncStorage.getItem(KEYS.theme),
          AsyncStorage.getItem(KEYS.lang),
          secureGet(KEYS.device),
          AsyncStorage.getItem(KEYS.sessions),
          AsyncStorage.getItem(KEYS.active),
          AsyncStorage.getItem(KEYS.defaultModel),
        ]);
        if (th === "light" || th === "dark" || th === "system") dispatch({ type: "SET_THEME", theme: th });
        if (lg === "ru" || lg === "en") dispatch({ type: "SET_LANG", lang: lg });
        if (defModelRaw) dispatch({ type: "SET_DEFAULT_MODEL", modelId: defModelRaw });
        dispatch({ type: "SET_TOKEN", token: tok });
        dispatch({ type: "SET_DEVICE", deviceId: dev || genDeviceId() });
        if (sessRaw) {
          try {
            const sessions = JSON.parse(sessRaw) as Session[];
            if (Array.isArray(sessions)) {
              dispatch({ type: "SET_SESSIONS", sessions });
              const savedActive = activeRaw && sessions.some((s) => s.id === activeRaw)
                ? activeRaw
                : (sessions[0]?.id ?? null);
              dispatch({ type: "SET_ACTIVE", sessionId: savedActive });
            }
          } catch {}
        }
      } catch {}
      dispatch({ type: "SET_MODELS", models: loadModels() });
      // кастомные провайдеры пользователя (SecureStore)
      const customs = await listCustomProviders().catch(() => []);
      dispatch({ type: "SET_CUSTOM_MODELS", models: providersToModels(customs) });
      dispatch({ type: "SET_READY" });
    })();

    // Встроенный Linux-рантайм (Termux bootstrap) — установка при первом запуске.
    // Не блокируем загрузку UI; результат нигде не ждём — команды [CMD:] сами
    // проверят готовность и покажут понятную ошибку, если рантайм ещё не готов.
    (async () => {
      try {
        const { ensureRuntime } = await import("../core/runtime");
        await ensureRuntime();
      } catch {}
    })();
  }, []);

  // ── persist ──
  // История чата сохраняется при ЛЮБОМ изменении сессий (не только new/delete),
  // с debounce 400 мс — чтобы не писать AsyncStorage на каждый токен стрима.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        // держим до 200 сессий, новые идут в начале массива → обрезаем хвост
        AsyncStorage.setItem(
          KEYS.sessions,
          JSON.stringify(state.sessions.slice(0, 200)),
        ).catch(() => {});
        AsyncStorage.setItem(KEYS.active, state.activeSessionId ?? "").catch(() => {});
      } catch {}
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state.sessions, state.activeSessionId, state.ready]);

  const saveState = useCallback(() => {
    const s = stateRef.current;
    try {
      AsyncStorage.setItem(KEYS.sessions, JSON.stringify(s.sessions.slice(0, 200))).catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    try {
      AsyncStorage.setItem(KEYS.theme, state.theme).catch(() => {});
      AsyncStorage.setItem(KEYS.lang, state.lang).catch(() => {});
      if (state.defaultModelId) {
        AsyncStorage.setItem(KEYS.defaultModel, state.defaultModelId).catch(() => {});
      }
    } catch {}
  }, [state.theme, state.lang, state.defaultModelId]);

  useEffect(() => {
    const s = stateRef.current;
    if (s.token) SecureStore.setItemAsync(KEYS.token, s.token).catch(() => {});
    else SecureStore.deleteItemAsync(KEYS.token).catch(() => {});
    if (s.deviceId) SecureStore.setItemAsync(KEYS.device, s.deviceId).catch(() => {});
  }, [state.token, state.deviceId]);

  const t = useCallback(
    (key: Parameters<typeof import("../i18n").t>[1]) => {
      const { t: tr } = require("../i18n");
      return tr(stateRef.current.lang, key);
    },
    [],
  );

  const newSession = useCallback((): string => {
    const s: Session = {
      id: genId(),
      name: "New chat",
      messages: [],
      modelId: stateRef.current.defaultModelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: "ADD_SESSION", session: s });
    setTimeout(saveState, 0);
    return s.id;
  }, [saveState]);

  const setDefaultModel = useCallback(
    (modelId: string | null) => dispatch({ type: "SET_DEFAULT_MODEL", modelId }),
    [],
  );

  const setActive = useCallback((id: string) => dispatch({ type: "SET_ACTIVE", sessionId: id }), []);
  const deleteSession = useCallback((id: string) => {
    dispatch({ type: "DELETE_SESSION", sessionId: id });
    setTimeout(saveState, 0);
  }, [saveState]);

  const store: Store = {
    state,
    theme,
    dispatch,
    t,
    newSession,
    setActive,
    deleteSession,
    setDefaultModel,
    saveState,
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export { genId, genDeviceId };
