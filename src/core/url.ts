/**
 * Нормализация chat-completion endpoint.
 *
 * Юзер вводит base URL провайдера как угодно:
 *   https://api.example.com
 *   https://api.example.com/v1
 *   https://api.example.com/v1/
 *   https://api.example.com/v1/chat/completions
 *   https://api.kilo.ai/api/openrouter
 *
 * А мы обязаны POST-ить ровно в /chat/completions — иначе 404.
 * Сюда вынесено, чтобы и gateway, и testProvider, и будущие
 * команды использовали одну логику.
 */

/** Путь, которым заканчиваются chat-completion endpoint'ы (без учёта регистра и слаша). */
const CHAT_PATH = "chat/completions";

/**
 * Приводит base URL к полному chat-completions endpoint.
 * Ничего не бьёт по сети — чистая строка.
 */
export function normalizeChatUrl(base: string): string {
  const clean = (base || "").trim().replace(/\/+$/, "");
  if (!clean) return clean;
  // уже заканчивается на /chat/completions — как есть
  if (clean.toLowerCase().endsWith("/" + CHAT_PATH)) return clean;
  return clean + "/" + CHAT_PATH;
}

/**
 * Базовый URL провайдера (для отображения в UI) — без /chat/completions.
 */
export function baseProviderUrl(endpoint: string): string {
  const clean = (endpoint || "").trim().replace(/\/+$/, "");
  const lower = clean.toLowerCase();
  if (lower.endsWith("/" + CHAT_PATH)) {
    return clean.slice(0, -(CHAT_PATH.length + 1));
  }
  return clean;
}
