import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Параметры модели, которые видит пользователь в окне выбора.
 *
 * Хранятся по имени модели: у каждой свой уровень рассуждения и свой потолок
 * контекста — переключил модель, настройки вернулись её собственные.
 */
export type ModelPrefs = {
  /** 0 — выкл, 1 — низкое, 2 — среднее, 3 — высокое */
  reasoning: 0 | 1 | 2 | 3;
  /** Потолок ответа в токенах (он же окно контекста запроса) */
  ctx: number;
};

const KEY = "aso.modelPrefs.v1";

export const CTX_STEPS = [8192, 16384, 32768, 65536, 131072, 200000] as const;
export const CTX_LABELS = ["8K", "16K", "32K", "64K", "128K", "200K"];
export const REASONING_LABELS = ["Выкл", "Низкое", "Среднее", "Высокое"];
export const REASONING_API = ["", "low", "medium", "high"] as const;

export const DEFAULT_PREFS: ModelPrefs = { reasoning: 0, ctx: 8192 };

type All = Record<string, ModelPrefs>;

export async function loadPrefs(modelName: string): Promise<ModelPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const all: All = raw ? JSON.parse(raw) : {};
    const p = all[modelName];
    if (!p) return DEFAULT_PREFS;
    return {
      reasoning: ([0, 1, 2, 3] as const).includes(p.reasoning) ? p.reasoning : 0,
      ctx: Number.isFinite(p.ctx) && p.ctx > 0 ? p.ctx : DEFAULT_PREFS.ctx,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(modelName: string, prefs: ModelPrefs): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const all: All = raw ? JSON.parse(raw) : {};
    all[modelName] = prefs;
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** Ближайший разрешённый шаг контекста (провайдер может не знать 200K). */
export function ctxIndex(ctx: number): number {
  let best = 0;
  for (let i = 0; i < CTX_STEPS.length; i++) if (CTX_STEPS[i] <= ctx) best = i;
  return best;
}
