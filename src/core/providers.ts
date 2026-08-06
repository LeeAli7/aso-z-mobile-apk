/**
 * Кастомные провайдеры пользователя (свой endpoint + API-ключ).
 * Хранятся в SecureStore — не в AsyncStorage (ключи не должны светиться).
 *
 * Логика как у ТГ-бота Aso: ПРОВАЙДЕР = контейнер, внутри СПИСОК моделей.
 * У каждой модели свои имя (в запросе), температура, system prompt.
 */
import * as SecureStore from "expo-secure-store";
import { ModelInfo } from "./gateway";
import { normalizeChatUrl } from "./url";

export interface CustomModel {
  id: string;
  /** имя модели в запросе (model: "gpt-4o-mini") */
  name: string;
  temperature?: number;
  systemPrompt?: string;
}

export interface CustomProvider {
  id: string;
  name: string; // отображаемое имя
  baseUrl: string; // полный endpoint провайдера
  apiKey: string | null;
  models: CustomModel[];
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
    const list = Array.isArray(arr) ? (arr as CustomProvider[]) : [];
    return list.map(migrateProvider);
  } catch {
    return [];
  }
}

/**
 * Миграция старых записей (v1: один провайдер = одна модель с полем `model`)
 * в новый формат (v2: провайдер = контейнер моделей).
 */
function migrateProvider(p: any): CustomProvider {
  if (!p) return p;
  // уже новый формат
  if (Array.isArray(p.models)) {
    return {
      id: p.id,
      name: p.name ?? "Провайдер",
      baseUrl: p.baseUrl ?? "",
      apiKey: p.apiKey ?? null,
      models: p.models.map((m: any) => ({
        id: m.id ?? genId(),
        name: m.name ?? m.model ?? "",
        temperature: m.temperature,
        systemPrompt: m.systemPrompt,
      })),
      createdAt: p.createdAt ?? Date.now(),
    };
  }
  // старый формат: поле `model` — оборачиваем в список
  return {
    id: p.id,
    name: p.name ?? "Провайдер",
    baseUrl: p.baseUrl ?? "",
    apiKey: p.apiKey ?? null,
    models: p.model
      ? [{ id: genId(), name: String(p.model), temperature: p.temperature, systemPrompt: p.systemPrompt }]
      : [],
    createdAt: p.createdAt ?? Date.now(),
  };
}

async function saveAll(list: CustomProvider[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(list));
}

export async function addCustomProvider(
  p: Omit<CustomProvider, "id" | "createdAt">,
): Promise<CustomProvider> {
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

/* ── Модели внутри провайдера ─────────────────────────── */

export async function addCustomModel(
  providerId: string,
  m: Omit<CustomModel, "id">,
): Promise<CustomModel> {
  const model: CustomModel = { ...m, id: genId() };
  const list = await listCustomProviders();
  const p = list.find((x) => x.id === providerId);
  if (!p) throw new Error("Provider not found");
  p.models.push(model);
  await saveAll(list);
  return model;
}

export async function updateCustomModel(
  providerId: string,
  modelId: string,
  patch: Partial<CustomModel>,
): Promise<void> {
  const list = await listCustomProviders();
  const p = list.find((x) => x.id === providerId);
  if (!p) throw new Error("Provider not found");
  const m = p.models.find((x) => x.id === modelId);
  if (!m) throw new Error("Model not found");
  Object.assign(m, patch);
  await saveAll(list);
}

export async function deleteCustomModel(providerId: string, modelId: string): Promise<void> {
  const list = await listCustomProviders();
  const p = list.find((x) => x.id === providerId);
  if (!p) throw new Error("Provider not found");
  p.models = p.models.filter((x) => x.id !== modelId);
  await saveAll(list);
}

/* ── ModelInfo (для gateway) ──────────────────────────── */

/**
 * Все модели всех провайдеров → список ModelInfo.
 * modelName делаем УНИКАЛЬНЫМ: `${providerId}:${model.name}` — иначе сессии
 * разных провайдеров с одинаковым именем модели будут конфликтовать.
 */
export function providersToModels(providers: CustomProvider[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      out.push({
        modelName: `${p.id}:${m.name}`,
        displayName: `${m.name}`,
        tier: "custom",
        premium: false,
        caps: [],
        baseUrl: normalizeChatUrl(p.baseUrl),
        providerIdx: -1,
        apiKey: p.apiKey,
        systemPrompt: m.systemPrompt,
        temperature: m.temperature,
        providerName: p.name,
        providerId: p.id,
      });
    }
  }
  return out;
}

/** Обратная совместимость: один провайдер → ModelInfo[] (все его модели). */
export function providerToModels(p: CustomProvider): ModelInfo[] {
  return providersToModels([p]);
}

/** Проверка соединения: лёгкий не-стрим запрос к endpoint. */
export async function testProvider(p: Pick<CustomProvider, "baseUrl" | "apiKey"> & { model: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(normalizeChatUrl(p.baseUrl), {
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
