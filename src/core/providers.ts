/**
 * Кастомные провайдеры пользователя (свой endpoint + API-ключ).
 * Хранятся в SecureStore — не в AsyncStorage (ключи не должны светиться).
 */
import * as SecureStore from "expo-secure-store";
import { ModelInfo } from "./gateway";

export interface CustomProvider {
  id: string;
  name: string; // отображаемое имя
  baseUrl: string; // полный endpoint провайдера
  apiKey: string | null;
  model: string; // имя модели в запросе
  temperature?: number;
  systemPrompt?: string;
  createdAt: number;
}

const KEY = "aso_custom_providers";

function genId(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {}
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function listCustomProviders(): Promise<CustomProvider[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CustomProvider[]) : [];
  } catch {
    return [];
  }
}

async function saveAll(list: CustomProvider[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(list));
}

export async function addCustomProvider(p: Omit<CustomProvider, "id" | "createdAt">): Promise<CustomProvider> {
  const full: CustomProvider = { ...p, id: genId(), createdAt: Date.now() };
  const list = await listCustomProviders();
  list.unshift(full);
  await saveAll(list);
  return full;
}

export async function updateCustomProvider(id: string, patch: Partial<CustomProvider>): Promise<void> {
  const list = await listCustomProviders();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error("Provider not found");
  Object.assign(p, patch);
  await saveAll(list);
}

export async function deleteCustomProvider(id: string): Promise<void> {
  const list = await listCustomProviders();
  await saveAll(list.filter((x) => x.id !== id));
}

/** Кастомный провайдер → ModelInfo для gateway. */
export function providerToModel(p: CustomProvider): ModelInfo {
  return {
    modelName: p.model,
    displayName: p.name,
    tier: "custom",
    premium: false,
    caps: [],
    baseUrl: p.baseUrl,
    providerIdx: -1,
    apiKey: p.apiKey,
    systemPrompt: p.systemPrompt,
    temperature: p.temperature,
  };
}

/** Проверка соединения: лёгкий не-стрим запрос к endpoint. */
export async function testProvider(p: Pick<CustomProvider, "baseUrl" | "apiKey" | "model">): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(p.baseUrl.replace(/\/+$/, ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      },
      body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: "ping" }], max_tokens: 5, stream: false }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 160)}` };
    }
    return { ok: true, message: "Соединение работает" };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}
