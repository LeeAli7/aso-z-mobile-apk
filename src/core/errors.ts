/**
 * Разбор ошибок: из сырого текста провайдера делаем короткое человеческое
 * объяснение и код для плашки. Ошибки инструментов сюда не попадают — они
 * уходят модели и пользователю не показываются вообще.
 */

export type ErrorInfo = {
  /** Короткий заголовок: «Лимит запроса». */
  title: string;
  /** Пояснение в одну строку. */
  detail: string;
  /** Код для чипа: 429 / NET / KEY / … */
  code: string;
  /** kind для цвета иконки. */
  kind: "limit" | "auth" | "net" | "server" | "input" | "unknown";
};

const pick = (s: string, re: RegExp) => {
  const m = s.match(re);
  return m ? m[1] : "";
};

/** Вытащить HTTP-статус из чего угодно: «HTTP 429», «status: 401», «(429)». */
function statusOf(raw: string): string {
  const m =
    raw.match(/\b(?:HTTP|http|status|Status|code|Code)[\s:="']*(\d{3})\b/) ||
    raw.match(/\b(4\d\d|5\d\d)\b/);
  return m ? m[1] : "";
}

/** Тело ответа провайдера — самое полезное, что можно показать. */
function bodyOf(raw: string): string {
  // JSON с error.message
  const j = raw.match(/"message"\s*:\s*"([^"]{2,240})"/);
  if (j) return j[1];
  // строка после статуса/двоеточия, без техмусора
  const line = raw
    .replace(/\s+/g, " ")
    .replace(/^(Error|TypeError|Ошибка)\s*:?\s*/i, "")
    .trim();
  return line.slice(0, 240);
}

export function classifyError(raw: string, fallbackTitle = "Ошибка"): ErrorInfo {
  const s = String(raw ?? "").trim();
  const low = s.toLowerCase();
  const code = statusOf(s);
  const detail = bodyOf(s) || "Без подробностей от провайдера.";

  if (/abort|cancel/i.test(low) && !/\d{3}/.test(s)) {
    return { title: "Запрос отменён", detail: "Ответ прерван до завершения.", code: "STOP", kind: "unknown" };
  }
  if (code === "429" || /rate.?limit|too many requests|quota|лимит/i.test(low)) {
    return {
      title: "Лимит запроса",
      detail: "Провайдер просит подождать: слишком много запросов подряд.",
      code: "429",
      kind: "limit",
    };
  }
  if (code === "401" || code === "403" || /unauthorized|invalid.*key|api.?key|forbidden|ключ/i.test(low)) {
    return {
      title: code === "403" ? "Доступ закрыт" : "Ключ не принят",
      detail: "Проверь ключ и права провайдера в настройках модели.",
      code: code || "KEY",
      kind: "auth",
    };
  }
  if (code === "404" || /model.*not found|no such model|не найдена модель/i.test(low)) {
    return {
      title: "Модель не найдена",
      detail: "Провайдер не знает такую модель — выбери другую.",
      code: code || "404",
      kind: "input",
    };
  }
  if (code === "413" || /too large|payload too large|request entity/i.test(low)) {
    return { title: "Слишком большой запрос", detail: "Сократи вложения или историю.", code: "413", kind: "input" };
  }
  if (/context.?(length|window)|maximum context|too many tokens|контекст/i.test(low)) {
    return {
      title: "Контекст переполнен",
      detail: "История длиннее окна модели — начни новую сессию.",
      code: code || "CTX",
      kind: "input",
    };
  }
  if (/timeout|timed out|время ожидания/i.test(low)) {
    return { title: "Превышено время ожидания", detail: "Провайдер не ответил вовремя.", code: "TIMEOUT", kind: "net" };
  }
  if (/network|fetch failed|enotfound|econn|socket|нет соединения|offline|dns/i.test(low)) {
    return { title: "Нет связи", detail: "Не дозвонились до провайдера — проверь сеть.", code: "NET", kind: "net" };
  }
  if (code && code.startsWith("5")) {
    return { title: "Сбой на стороне провайдера", detail, code, kind: "server" };
  }
  if (code === "400" || code === "422") {
    return { title: "Запрос отклонён", detail, code, kind: "input" };
  }
  if (/no model|нет модели|модель не выбрана|не выбрана модель|выбери модель/i.test(low)) {
    return { title: "Модель не выбрана", detail: "Открой окно модели и выбери провайдера и модель.", code: "MODEL", kind: "input" };
  }
  if (/empty response|пустой ответ/i.test(low)) {
    return { title: "Пустой ответ", detail: "Провайдер вернул пустое тело — попробуй ещё раз.", code: "EMPTY", kind: "unknown" };
  }
  return { title: fallbackTitle, detail, code: code || "ERR", kind: "unknown" };
}
