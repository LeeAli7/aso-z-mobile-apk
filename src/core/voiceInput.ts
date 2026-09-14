/**
 * voiceInput.ts — проводка голосового ввода (expo-speech-recognition).
 *
 * Кнопка микрофона в капсуле ChatScreen была декором без onPress.
 * Здесь — движковая сторона: пермишены, start/stop, статус прослушивания.
 * UI подписывается на события модуля напрямую (useSpeechRecognitionEvent),
 * текст дописывается в инпут, НЕ отправляется сам.
 *
 * На web работает через браузерный SpeechRecognition (модуль сам фолбэчится).
 * Без нативного модуля — available=false, UI прячет кнопку.
 */
import { Platform } from "react-native";

let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch {
  mod = null;
}

/** Доступен ли голосовой ввод на этом устройстве. */
export function voiceInputAvailable(): boolean {
  try {
    return !!mod && typeof mod.start === "function";
  } catch {
    return false;
  }
}

/** Запросить доступ к микрофону. Возвращает granted. */
export async function requestVoicePermission(): Promise<boolean> {
  if (!voiceInputAvailable()) return false;
  try {
    const perm = await mod.requestPermissionsAsync().catch(() => null);
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
    mod.start({ lang, interimResults: true, addsPunctuation: true });
  } catch {}
}

/** Остановить (ждёт финальный результат). */
export function stopListening(): void {
  if (!voiceInputAvailable()) return;
  try {
    mod.stop();
  } catch {}
}

/** Прервать без результата (размонтирование экрана). */
export function abortListening(): void {
  if (!voiceInputAvailable()) return;
  try {
    mod.abort();
  } catch {}
}

/** Сырой модуль — для useSpeechRecognitionEvent в UI. */
export function voiceModule(): any {
  return mod;
}
