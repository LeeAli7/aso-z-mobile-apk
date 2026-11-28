/**
 * Таймауты запроса — порт из OpenCode v2
 * (`packages/core/src/provider.ts`, `packages/core/src/aisdk.ts`).
 *
 * Там их три, и они не выдуманы: провайдеры (DeepSeek) прямо просили давать
 * минимум 15 минут тишины, потому что модель может молчать, пока думает.
 *
 *  - headerTimeout — сколько ждать первые байты ответа (по умолчанию 5 минут);
 *  - chunkTimeout  — сколько ждать следующий кусок стрима (по умолчанию 15 минут);
 *  - false         — выключить проверку.
 *
 * Значения можно переопределить на уровне провайдера (как `timeout`,
 * `headerTimeout`, `chunkTimeout` в настройках провайдера у OpenCode).
 */

export const DEFAULT_HEADER_TIMEOUT_MS = 300_000; // 5 минут — как DEFAULT_TIMEOUT_MS
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000;  // 15 минут — как DEFAULT_CHUNK_TIMEOUT_MS

export interface TimeoutSettings {
  headerTimeout?: number | false;
  chunkTimeout?: number | false;
}

export interface ResolvedTimeouts {
  headerTimeout: number | false;
  chunkTimeout: number | false;
}

const valid = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

export function resolveTimeouts(settings?: TimeoutSettings): ResolvedTimeouts {
  return {
    headerTimeout: settings?.headerTimeout === false ? false : (valid(settings?.headerTimeout) ?? DEFAULT_HEADER_TIMEOUT_MS),
    chunkTimeout: settings?.chunkTimeout === false ? false : (valid(settings?.chunkTimeout) ?? DEFAULT_CHUNK_TIMEOUT_MS),
  };
}

/** Человеческое «5 минут» / «15 минут» для сообщения об ошибке. */
export function humanMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min >= 1) return `${min} мин`;
  return `${Math.round(ms / 1000)} с`;
}
