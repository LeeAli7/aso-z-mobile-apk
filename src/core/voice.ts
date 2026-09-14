/**
 * voice.ts — настройки голоса (Hermes: stt/*, tts/*).
 *
 * STT: голосовой ввод (expo-speech-recognition, уже в fix-voice-glass).
 * TTS: озвучка ответов (expo-speech). Здесь только префы + пресеты,
 * движок синтеза/распознавания подключает UI-слой.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

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
    if (!raw) return { ...DEFAULT_VOICE_CONFIG };
    return { ...DEFAULT_VOICE_CONFIG, ...JSON.parse(raw) };
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
  return next;
}
