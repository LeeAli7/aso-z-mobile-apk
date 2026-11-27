/**
 * Разбор ошибок: из сырого текста провайдера делаем короткое человеческое
 * объяснение, код для плашки и решение — повторять или нет.
 *
 * Главное правило (как в OpenCode v2): «лимит» и «квота» — разные вещи.
 * Лимит временный, его ждём и повторяем. Квота/баланс/ключ — не повторяем
 * никогда, иначе мы просто жжём попытки и показываем ложную надежду.
 */

export type ErrorKind =
  | "limit"
  | "quota"
  | "auth"
  | "net"
  | "server"
  | "input"
  | "context"
  | "policy"
  | "unknown";

export type ErrorInfo = {
  /** Короткий заголовок: «Лимит запроса». */
  title: string;
  /** Пояснение в одну строку. */
  detail: string;
  /** Код для чипа: 429 / NET / KEY / … */
  code: string;
  /** kind для цвета иконки. */
  kind: ErrorKind;
  /** Есть ли смысл повторять запрос. */
  retryable: boolean;
  /** Сколько всего попыток делать (0 — не повторять). */
  maxAttempts: number;
  /** Сколько ждать перед повтором, если провайдер сам сказал. */
  retryAfterMs?: number;
};

/** Тело ответа провайдера — самое полезное, что можно показать. */
function bodyOf(raw: string): string {
  const j = raw.match(/"message"\s*:\s*"([^"]{2,240})"/);
  if (j) return j[1];
  const line = raw
    .replace(/\s+/g, " ")
    .replace(/^(Error|TypeError|Ошибка)\s*:?\s*/i, "")
    .trim();
  return line.slice(0, 240);
}

/** Вытащить HTTP-статус из чего угодно: «HTTP 429», «status: 401», «(429)». */
function statusOf(raw: string): string {
  const m =
    raw.match(/\b(?:HTTP|http|status|Status|code|Code)[\s:="']*(\d{3})\b/) ||
    raw.match(/^\s*(\d{3})\b/) ||
    raw.match(/\b(4\d\d|5\d\d)\b/);
  return m ? m[1] : "";
}

/** Сколько провайдер просит подождать — из заголовка или из текста. */
function retryAfterFrom(raw: string): number | undefined {
  const patterns = [
    /retry[- ]after[:\s]*(\d+(?:[.,]\d+)?)/i,
    /try again in\s*(\d+(?:[.,]\d+)?)\s*(ms|мс|s|sec|seconds|сек)?/i,
    /retry in\s*(\d+(?:[.,]\d+)?)\s*(ms|мс|s|sec|seconds|сек)?/i,
    /повтор[^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*(ms|мс|s|sec|сек)?/i,
    /(?:available|доступно)\s*(?:again|снова)?\s*(?:in|через)\s*(\d+(?:[.,]\d+)?)\s*(ms|мс|s|sec|сек)?/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const value = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const ms = unit === "ms" || unit === "мс" ? value : value * 1000;
    return Math.min(15 * 60_000, Math.max(500, ms));
  }
  return undefined;
}

const QUOTA_RE =
  /insufficient[_ ]?quota|exceeded your current quota|quota (?:has been )?exceeded|billing|credit balance|payment required|out of credits|пополни|баланс|квота|credit_limit/i;
const LIMIT_RE =
  /rate.?limit|too many requests|resource[_ ]exhausted|requests per (?:minute|day)|per minute|rpm|tpm|лимит запросов|слишком много запросов|превышен лимит/i;
const CONTEXT_RE =
  /context.?(?:length|window)|maximum context|too many tokens|prompt is too long|context_length_exceeded|reduce the length|контекст/i;
const POLICY_RE = /content[_ ]policy|safety|moderation|flagged|blocked by|цензур|политик/i;

export function classifyError(raw: string, fallbackTitle = "Ошибка"): ErrorInfo {
  const s = String(raw ?? "").trim();
  const low = s.toLowerCase();
  const code = statusOf(s);
  const detail = bodyOf(s) || "Без подробностей от провайдера.";
  const after = retryAfterFrom(s);

  if (/abort|cancel/i.test(low) && !/\d{3}/.test(s)) {
    return {
      title: "Запрос отменён",
      detail: "Ответ прерван до завершения.",
      code: "STOP",
      kind: "unknown",
      retryable: false,
      maxAttempts: 0,
    };
  }

  // Квота/баланс/оплата — повтор не поможет, только пополнение или другой ключ.
  // Но «quota exceeded ... per minute» у Google — это лимит частоты, а не баланс.
  const perWindow = /per (?:minute|second|day)|requests per|rpm|tpm|resource[_ ]exhausted/i.test(low);
  if (code === "402" || (QUOTA_RE.test(low) && !perWindow)) {
    return {
      title: "Закончилась квота",
      detail: "Лимит аккаунта исчерпан — пополни баланс или подключи другой ключ.",
      code: code || "QUOTA",
      kind: "quota",
      retryable: false,
      maxAttempts: 0,
    };
  }

  // Временный лимит частоты: ждём столько, сколько просит провайдер.
  if (code === "429" || LIMIT_RE.test(low)) {
    return {
      title: "Лимит запросов",
      detail: after
        ? `Провайдер просит подождать ${Math.ceil(after / 1000)} с — повторим автоматически.`
        : "Провайдер просит подождать: слишком много запросов подряд.",
      code: "429",
      kind: "limit",
      retryable: true,
      maxAttempts: 2,
      retryAfterMs: after,
    };
  }

  if (code === "401" || code === "403" || /unauthorized|invalid.*key|api.?key|forbidden|ключ/i.test(low)) {
    return {
      title: code === "403" ? "Доступ закрыт" : "Ключ не принят",
      detail: "Проверь ключ и права провайдера в настройках модели.",
      code: code || "KEY",
      kind: "auth",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (CONTEXT_RE.test(low)) {
    return {
      title: "Контекст переполнен",
      detail: "История длиннее окна модели — сократим и повторим.",
      code: code || "CTX",
      kind: "context",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (code === "404" || /model.*not found|no such model|не найдена модель/i.test(low)) {
    return {
      title: "Модель не найдена",
      detail: "Провайдер не знает такую модель — выбери другую.",
      code: code || "404",
      kind: "input",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (code === "413" || /too large|payload too large|request entity/i.test(low)) {
    return {
      title: "Слишком большой запрос",
      detail: "Сократи вложения или историю.",
      code: "413",
      kind: "input",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (POLICY_RE.test(low)) {
    return {
      title: "Запрос отклонён фильтром",
      detail: "Провайдер отказал по правилам безопасности — переформулируй.",
      code: code || "POLICY",
      kind: "policy",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (/timeout|timed out|время ожидания/i.test(low)) {
    return {
      title: "Превышено время ожидания",
      detail: "Провайдер не ответил вовремя.",
      code: "TIMEOUT",
      kind: "net",
      retryable: true,
      maxAttempts: 3,
    };
  }

  if (/network|fetch failed|enotfound|econn|socket|нет соединения|offline|dns|unreachable/i.test(low)) {
    return {
      title: "Нет связи",
      detail: "Не дозвонились до провайдера — проверь сеть.",
      code: "NET",
      kind: "net",
      retryable: true,
      maxAttempts: 3,
    };
  }

  if (code && code.startsWith("5")) {
    return {
      title: "Сбой на стороне провайдера",
      detail,
      code,
      kind: "server",
      retryable: true,
      maxAttempts: 3,
      retryAfterMs: after,
    };
  }

  if (code === "400" || code === "422") {
    return {
      title: "Запрос отклонён",
      detail,
      code,
      kind: "input",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (/no model|нет модели|модель не выбрана|не выбрана модель|выбери модель/i.test(low)) {
    return {
      title: "Модель не выбрана",
      detail: "Открой окно модели и выбери провайдера и модель.",
      code: "MODEL",
      kind: "input",
      retryable: false,
      maxAttempts: 0,
    };
  }

  if (/empty response|пустой ответ/i.test(low)) {
    return {
      title: "Пустой ответ",
      detail: "Провайдер вернул пустое тело — попробуй ещё раз.",
      code: "EMPTY",
      kind: "unknown",
      retryable: true,
      maxAttempts: 1,
    };
  }

  return {
    title: fallbackTitle,
    detail,
    code: code || "ERR",
    kind: "unknown",
    retryable: false,
    maxAttempts: 0,
  };
}

/** Пауза перед повтором: сказанное провайдером важнее нашей экспоненты. */
export function retryWaitMs(info: ErrorInfo, attempt: number): number {
  if (info.retryAfterMs && info.retryAfterMs > 0) {
    // ±15 % джиттера, чтобы несколько запросов не били в одну секунду
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(info.retryAfterMs * jitter);
  }
  // Лимит частоты почти всегда «в минуту»: 1,5 с ничего не дадут, ждём по-взрослому.
  const base =
    info.kind === "limit" ? (attempt === 0 ? 6_000 : 15_000) : 1500 * Math.pow(2, attempt);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(Math.min(20_000, base) * jitter);
}
