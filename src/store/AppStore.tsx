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
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Theme, ThemeName, themes } from "../theme/tokens";
import { Lang } from "../i18n";
import { ModelInfo, loadModels } from "../core/gateway";

/* ── Types ─────────────────────────────────────────────── */

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface Session {
  id: string;
  name: string;
  messages: Msg[];
  /** modelName выбранной модели (строка), null = авто */
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
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
  sessions: Session[];
  activeSessionId: string | null;
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
  | { type: "SET_SYNC"; status: string; syncing?: boolean }
  | { type: "SET_DEVICE"; deviceId: string }
  | { type: "ADD_SESSION"; session: Session }
  | { type: "SET_SESSIONS"; sessions: Session[] }
  | { type: "SET_ACTIVE"; sessionId: string | null }
  | { type: "ADD_MSG"; sessionId: string; msg: Msg }
  | { type: "UPDATE_MSG"; sessionId: string; msgId: string; patch: Partial<Msg> }
  | { type: "DELETE_SESSION"; sessionId: string };

function genId(): string {
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
  sessions: [],
  activeSessionId: null,
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
    case "SET_ACTIVE":
      return { ...state, activeSessionId: action.sessionId };
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
  saveState: () => void;
}

const Ctx = createContext<Store | null>(null);

const KEYS = {
  token: "aso_token",
  theme: "aso_theme",
  lang: "aso_lang",
  device: "aso_device",
  sessions: "aso_sessions",
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const theme = useMemo(() => themes[state.theme] ?? themes.dark, [state.theme]);

  // ── bootstrap ──
  useEffect(() => {
    (async () => {
      try {
        const [tok, th, lg, dev, sessRaw] = await Promise.all([
          SecureStore.getItemAsync(KEYS.token),
          AsyncStorage.getItem(KEYS.theme),
          AsyncStorage.getItem(KEYS.lang),
          SecureStore.getItemAsync(KEYS.device),
          AsyncStorage.getItem(KEYS.sessions),
        ]);
        if (th === "light" || th === "dark") dispatch({ type: "SET_THEME", theme: th });
        if (lg === "ru" || lg === "en") dispatch({ type: "SET_LANG", lang: lg });
        dispatch({ type: "SET_TOKEN", token: tok });
        dispatch({ type: "SET_DEVICE", deviceId: dev || genDeviceId() });
        if (sessRaw) {
          try {
            const sessions = JSON.parse(sessRaw) as Session[];
            if (Array.isArray(sessions)) {
              dispatch({ type: "SET_SESSIONS", sessions });
              dispatch({ type: "SET_ACTIVE", sessionId: sessions[0]?.id ?? null });
            }
          } catch {}
        }
      } catch {}
      dispatch({ type: "SET_MODELS", models: loadModels() });
      dispatch({ type: "SET_READY" });
    })();
  }, []);

  // ── persist ──
  const saveState = useCallback(() => {
    const s = stateRef.current;
    try {
      AsyncStorage.setItem(KEYS.sessions, JSON.stringify(s.sessions.slice(0, 50))).catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    try {
      AsyncStorage.setItem(KEYS.theme, state.theme).catch(() => {});
      AsyncStorage.setItem(KEYS.lang, state.lang).catch(() => {});
    } catch {}
  }, [state.theme, state.lang]);

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
      modelId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: "ADD_SESSION", session: s });
    setTimeout(saveState, 0);
    return s.id;
  }, [saveState]);

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
