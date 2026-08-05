/**
 * Конфигурация приложения.
 *
 * Базовый URL нашего API нужен ТОЛЬКО для синхронизации аккаунта с ТГ
 * (разовый обмен: @username → подтверждение в боте → JWT) и больше ни для
 * чего. LLM-трафик идёт напрямую к провайдерам (см. core/gateway.ts).
 *
 * Адрес настраивается в приложении (Настройки → Сервер) и хранится
 * на устройстве; по умолчанию — локальный dev-адрес.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "api_base";
const DEFAULT_BASE = "http://127.0.0.1:8000";

let _base: string = DEFAULT_BASE;

/** Загрузить сохранённый адрес сервера (вызывается при старте приложения). */
export async function loadApiBase(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v && v.trim()) _base = v.trim().replace(/\/+$/, "");
  } catch {}
}

/** Сохранить новый адрес сервера. */
export async function setApiBase(v: string): Promise<void> {
  const clean = v.trim().replace(/\/+$/, "") || DEFAULT_BASE;
  _base = clean;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, clean);
  } catch {}
}

export const config = {
  get apiBase(): string {
    return _base;
  },
} as const;
