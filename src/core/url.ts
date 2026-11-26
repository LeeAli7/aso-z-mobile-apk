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
  const lower = clean.toLowerCase();

  // Google Generative Language: у него есть OpenAI-совместимый слой
  // (/v1beta/openai), но люди вставляют нативный endpoint вида
  // .../v1beta/models/gemini-2.5-pro:generateContent — на него уходит
  // OpenAI-тело, и Google отвечает 404, а инструменты «не поддерживаются».
  // Приводим любой такой адрес к /v1beta/openai/chat/completions.
  if (lower.includes("generativelanguage.googleapis.com")) {
    const m = clean.match(/^(https?:\/\/generativelanguage\.googleapis\.com\/(?:v1beta|v1))(?:[\/?#].*)?$/i);
    if (m) return m[1] + "/openai/chat/completions";
    if (lower.endsWith("/openai/" + CHAT_PATH)) return clean;
    if (lower.endsWith("/openai")) return clean + "/" + CHAT_PATH;
    return clean + "/" + CHAT_PATH;
  }

  // уже заканчивается на /chat/completions — как есть
  if (lower.endsWith("/" + CHAT_PATH)) return clean;
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

/**
 * Имя модели в теле запроса. Люди копируют его из Google-документации
 * вместе с префиксом и методом: `models/gemini-2.5-pro:generateContent`.
 * В теле должно быть чистое `gemini-2.5-pro`.
 */
export function apiModelName(name: string): string {
  let s = String(name || "").trim();
  s = s.replace(/^models\//i, "");
  s = s.replace(/:\w+$/, "");
  return s;
}
