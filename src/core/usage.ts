/**
 * usage.ts — учёт токенов (Hermes: display.show_cost / usage).
 *
 * Провайдеры при stream_options.include_usage присылают в SSE usage-блок;
 * gateway складывает его через recordUsage. UI (экран Использование)
 * читает getUsageSummary.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ModelUsage {
  modelKey: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  updatedAt: number;
}

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const KEY = "aso_usage";

async function loadAll(): Promise<Record<string, ModelUsage>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Record<string, ModelUsage>) : {};
  } catch {
    return {};
  }
}

/** Записать usage одного запроса. Никогда не бросает. */
export async function recordUsage(modelKey: string, provider: string, u: UsageRecord): Promise<void> {
  try {
    const all = await loadAll();
    const cur = all[modelKey] ?? { modelKey, provider, promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, updatedAt: 0 };
    cur.provider = provider || cur.provider;
    cur.promptTokens += Math.max(0, u.promptTokens | 0);
    cur.completionTokens += Math.max(0, u.completionTokens | 0);
    cur.totalTokens += Math.max(0, u.totalTokens | 0);
    cur.calls += 1;
    cur.updatedAt = Date.now();
    all[modelKey] = cur;
    // держим до 100 моделей
    const keys = Object.keys(all);
    if (keys.length > 100) {
      keys
        .sort((a, b) => (all[a].updatedAt ?? 0) - (all[b].updatedAt ?? 0))
        .slice(0, keys.length - 100)
        .forEach((k) => delete all[k]);
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** Сводка для UI: по моделям + итог. */
export async function getUsageSummary(): Promise<{ models: ModelUsage[]; total: UsageRecord & { calls: number } }> {
  const all = await loadAll();
  const models = Object.values(all).sort((a, b) => b.totalTokens - a.totalTokens);
  const total = models.reduce(
    (acc, m) => ({
      promptTokens: acc.promptTokens + m.promptTokens,
      completionTokens: acc.completionTokens + m.completionTokens,
      totalTokens: acc.totalTokens + m.totalTokens,
      calls: acc.calls + m.calls,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
  );
  return { models, total };
}

export async function clearUsage(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
