/**
 * Разбор ошибок: из сырого текста провайдера делаем короткое человеческое
 * объяснение, код для плашки и решение — повторять или нет.
 *
 * Главное правило (как в OpenCode v2): «лимит» и «квота» — разные вещи.
 * Лимит временный, его ждём и повторяем. Квота/баланс/ключ — не повторяем
 * никогда, иначе мы просто жжём попытки и показываем ложную надежду.
 *
 * Тексты живут в i18n: здесь только ключи, поэтому ошибки сразу двуязычные.
 */
import { t, type Translation } from "../i18n/index";

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
  /** Готовый русский заголовок — для логов и мест без языка. */
  title: string;
  /** Готовое русское пояснение — для логов. */
  detail: string;
  /** Ключи для интерфейса: переводятся на язык пользователя. */
  titleKey: keyof Translation;
  detailKey: keyof Translation;
  params?: Record<string, string | number>;
  /** Код для чипа: 429 / NET / KEY / … */
  code: string;
  kind: ErrorKind;
  /** Есть ли смысл повторять запрос. */
  retryable: boolean;
  /** Сколько всего попыток делать (0 — не повторять). */
  maxAttempts: number;
  /** Сколько ждать перед повтором, если провайдер сам сказал. */
  retryAfterMs?: number;
  /** Провайдер назвал потолок токенов в минуту — под него надо ужать запрос. */
  limitTokens?: number;
};

type Opts = {
  kind: ErrorKind;
  code: string;
  titleKey: keyof Translation;
  detailKey: keyof Translation;
  params?: Record<string, string | number>;
  retryable?: boolean;
  maxAttempts?: number;
  retryAfterMs?: number;
  /** Сырой текст провайдера — показываем вместо шаблона, если он полезнее. */
  detail?: string;
  limitTokens?: number;
};

function mk(o: Opts): ErrorInfo {
  const detail = o.detail?.trim() || t("ru", o.detailKey, o.params);
  return {
    title: t("ru", o.titleKey),
    detail,
    titleKey: o.titleKey,
    detailKey: o.detailKey,
    params: o.params,
    code: o.code,
    kind: o.kind,
    retryable: o.retryable ?? false,
    maxAttempts: o.maxAttempts ?? 0,
    retryAfterMs: o.retryAfterMs,
    limitTokens: o.limitTokens,
  };
}

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

export function classifyError(raw: string, fallbackTitle = ""): ErrorInfo {
  const s = String(raw ?? "").trim();
  const low = s.toLowerCase();
  const code = statusOf(s);
  const detail = bodyOf(s);
  const after = retryAfterFrom(s);

  // ── Потолок токенов в минуту (Groq: 413 + "tokens per minute (TPM): Limit 8000",
  // OpenAI: 429 + "tokens per min") — это ВРЕМЕННЫЙ лимит, но повторять его
  // вслепую бессмысленно: запрос всё равно не пролезет. Надо ужать и повторить.
  const tpm = low.match(/(?:tokens? per minute|\btpm\b)[^]{0,120}?limit\s*(\d{3,})/i);
  if (tpm || /rate_limit_exceeded/i.test(low) && /tokens? per minute/i.test(low)) {
    return mk({
      kind: "limit",
      code: "TPM",
      titleKey: "err_tpm_title",
      detailKey: "err_tpm_detail",
      params: { n: tpm ? Number(tpm[1]).toLocaleString("ru-RU") : "" },
      retryable: true,
      maxAttempts: 2,
      limitTokens: tpm ? Number(tpm[1]) : undefined,
    });
  }

  if (/abort|cancel/i.test(low) && !/\d{3}/.test(s)) {
    return mk({ kind: "unknown", code: "STOP", titleKey: "err_abort_title", detailKey: "err_abort_detail" });
  }

  // Квота/баланс/оплата — повтор не поможет, только пополнение или другой ключ.
  // Но «quota exceeded ... per minute» у Google — это лимит частоты, а не баланс.
  // «в минуту/секунду» — временный лимит; «в день / free tier» — дневная квота,
  // её ждать бессмысленно (Google: free_tier_requests, limit: 20).
  const perMinute = /per minute|per min\b|per second|requests per minute|\brpm\b|\btpm\b|tokens? per minute|resource[_ ]exhausted/i.test(low);
  const daily = /per day|per-day|daily|free[_ ]tier|free tier|requests per day/i.test(low);
  // дневная квота — только если провайдер не назвал срок повтора;
  // «retry in 12.3s» при free_tier — это минутный лимит, его ждём
  if (code === "402" || (daily && !perMinute && !after) || (QUOTA_RE.test(low) && !perMinute && !daily)) {
    return mk({ kind: "quota", code: code || "QUOTA", titleKey: "err_quota_title", detailKey: "err_quota_detail" });
  }

  // Временный лимит частоты: ждём столько, сколько просит провайдер.
  if (code === "429" || LIMIT_RE.test(low)) {
    return mk({
      kind: "limit",
      code: "429",
      titleKey: "err_limit_title",
      detailKey: after ? "err_limit_wait" : "err_limit_detail",
      params: after ? { n: Math.ceil(after / 1000) } : undefined,
      retryable: true,
      maxAttempts: 2,
      retryAfterMs: after,
    });
  }

  if (code === "401" || code === "403" || /unauthorized|invalid.*key|api.?key|forbidden|ключ/i.test(low)) {
    return mk({
      kind: "auth",
      code: code || "KEY",
      titleKey: code === "403" ? "err_auth_forbidden" : "err_auth_title",
      detailKey: "err_auth_detail",
    });
  }

  if (CONTEXT_RE.test(low)) {
    return mk({ kind: "context", code: code || "CTX", titleKey: "err_ctx_title", detailKey: "err_ctx_detail" });
  }

  if (code === "404" || /model.*not found|no such model|не найдена модель/i.test(low)) {
    return mk({ kind: "input", code: code || "404", titleKey: "err_model_title", detailKey: "err_model_detail" });
  }

  if (code === "413" || /too large|payload too large|request entity/i.test(low)) {
    return mk({ kind: "input", code: "413", titleKey: "err_large_title", detailKey: "err_large_detail" });
  }

  if (POLICY_RE.test(low)) {
    return mk({ kind: "policy", code: code || "POLICY", titleKey: "err_policy_title", detailKey: "err_policy_detail" });
  }

  if (/timeout|timed out|время ожидания/i.test(low)) {
    return mk({
      kind: "net",
      code: "TIMEOUT",
      titleKey: "err_timeout_title",
      detailKey: "err_timeout_detail",
      retryable: true,
      maxAttempts: 3,
    });
  }

  if (/network|fetch failed|enotfound|econn|socket|нет соединения|offline|dns|unreachable/i.test(low)) {
    return mk({
      kind: "net",
      code: "NET",
      titleKey: "err_net_title",
      detailKey: "err_net_detail",
      retryable: true,
      maxAttempts: 3,
    });
  }

  if (code && code.startsWith("5")) {
    return mk({
      kind: "server",
      code,
      titleKey: "err_server_title",
      detailKey: "err_nodetail",
      detail,
      retryable: true,
      maxAttempts: 3,
      retryAfterMs: after,
    });
  }

  if (code === "400" || code === "422") {
    return mk({ kind: "input", code, titleKey: "err_input_title", detailKey: "err_nodetail", detail });
  }

  if (/no model|нет модели|модель не выбрана|не выбрана модель|выбери модель/i.test(low)) {
    return mk({ kind: "input", code: "MODEL", titleKey: "err_nomodel_title", detailKey: "err_nomodel_detail" });
  }

  if (/empty response|пустой ответ/i.test(low)) {
    return mk({
      kind: "unknown",
      code: "EMPTY",
      titleKey: "err_empty_title",
      detailKey: "err_empty_detail",
      retryable: true,
      maxAttempts: 1,
    });
  }

  return mk({
    kind: "unknown",
    code: code || "ERR",
    titleKey: "err_unknown_title",
    detailKey: "err_nodetail",
    detail: detail || fallbackTitle,
  });
}

/** Пауза перед повтором: сказанное провайдером важнее нашей экспоненты. */
export function retryWaitMs(info: ErrorInfo, attempt: number): number {
  if (info.retryAfterMs && info.retryAfterMs > 0) {
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(info.retryAfterMs * jitter);
  }
  // Лимит частоты почти всегда «в минуту»: 1,5 с ничего не дадут, ждём по-взрослому.
  const base =
    info.kind === "limit" ? (attempt === 0 ? 6_000 : 15_000) : 1500 * Math.pow(2, attempt);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(Math.min(20_000, base) * jitter);
}
