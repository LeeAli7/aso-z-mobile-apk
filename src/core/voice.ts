/**
 * voice.ts — голос (Hermes: stt/*, tts/*) + проводка ввода.
 *
 * STT-префы (legacy-фолбэк SettingsScreen) + проводка expo-speech-recognition:
 * пермишены, start/stop, статус. UI подписывается на события модуля напрямую
 * (useSpeechRecognitionEvent), текст дописывается в инпут, НЕ отправляется сам.
 * TTS-движок (синтез) — Фаза 5; здесь только префы.
 *
 * На web работает через браузерный SpeechRecognition (модуль сам фолбэчится).
 * Без нативного модуля — available=false, UI прячет кнопку.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface VoiceConfig {
  /** Голосовой ввод включён. */
  sttEnabled: boolean;
  /** Язык распознавания. */
  sttLang: string;
  /** Озвучка ответов. */
  ttsEnabled: boolean;
  /** Язык/голос синтеза. */
  ttsLang: string;
  /** Скорость речи 0.5..2.0. */
  ttsRate: number;
}

const KEY = "aso_voice_config";

/** Legacy-ключи SettingsScreen (Фаза 1: единый стор читает их, пока UI на них пишет). */
const LEGACY_KEYS = {
  sttEnabled: "aso_stt_enabled",
  sttProvider: "aso_stt_provider",
  ttsProvider: "aso_tts_provider",
} as const;

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  sttEnabled: true,
  sttLang: "ru-RU",
  ttsEnabled: false,
  ttsLang: "ru-RU",
  ttsRate: 1.0,
};

export async function loadVoiceConfig(): Promise<VoiceConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const base = { ...DEFAULT_VOICE_CONFIG };
    if (raw) {
      try {
        Object.assign(base, JSON.parse(raw));
      } catch {}
    } else {
      // Фаза 1: JSON-конфига нет — подхватываем legacy-флаг UI.
      // Провайдеры STT/TTS остаются на UI до Фазы 5 (там TTS-движок).
      try {
        const se = await AsyncStorage.getItem(LEGACY_KEYS.sttEnabled);
        if (se !== null) base.sttEnabled = se !== "0";
      } catch {}
    }
    return base;
  } catch {
    return { ...DEFAULT_VOICE_CONFIG };
  }
}

export async function saveVoiceConfig(patch: Partial<VoiceConfig>): Promise<VoiceConfig> {
  const cur = await loadVoiceConfig();
  const next: VoiceConfig = { ...cur, ...patch };
  if (next.ttsRate < 0.5) next.ttsRate = 0.5;
  if (next.ttsRate > 2.0) next.ttsRate = 2.0;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  // Фаза 1: зеркалим stt-флаг в legacy-ключ — UI видит то же.
  try {
    await AsyncStorage.setItem(LEGACY_KEYS.sttEnabled, next.sttEnabled ? "1" : "0");
  } catch {}
  return next;
}

/* ── Проводка ввода (бывший voiceInput.ts, Фаза 1: один файл голоса) ── */

let voiceMod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  voiceMod = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch {
  voiceMod = null;
}

/** Доступен ли голосовой ввод на этом устройстве. */
export function voiceInputAvailable(): boolean {
  try {
    return !!voiceMod && typeof voiceMod.start === "function";
  } catch {
    return false;
  }
}

/** Запросить доступ к микрофону. Возвращает granted. */
export async function requestVoicePermission(): Promise<boolean> {
  if (!voiceInputAvailable()) return false;
  try {
    const perm = await voiceMod.requestPermissionsAsync().catch(() => null);
    if (!perm) return Platform.OS === "web"; // web спрашивает сам при start
    return perm.granted !== false;
  } catch {
    return false;
  }
}

/** Начать прослушивание. lang: ru-RU / en-US. */
export function startListening(lang: string): void {
  if (!voiceInputAvailable()) return;
  try {
    voiceMod.start({ lang, interimResults: true, addsPunctuation: true });
  } catch {}
}

/** Остановить (ждёт финальный результат). */
export function stopListening(): void {
  if (!voiceInputAvailable()) return;
  try {
    voiceMod.stop();
  } catch {}
}

/** Прервать без результата (размонтирование экрана). */
export function abortListening(): void {
  if (!voiceInputAvailable()) return;
  try {
    voiceMod.abort();
  } catch {}
}

/** Сырой модуль — для useSpeechRecognitionEvent в UI. */
export function voiceModule(): any {
  return voiceMod;
}
