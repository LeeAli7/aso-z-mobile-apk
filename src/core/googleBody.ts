/**
 * Подгонка тела запроса под OpenAI-совместимый слой Google
 * (`generativelanguage.googleapis.com/v1beta/openai`).
 *
 * Gemini валидирует тело строже OpenAI: незнакомые поля и пустые части
 * сообщения дают 400 `Request contains an invalid argument` — без указания,
 * что именно не так. Поэтому:
 *  - убираем `stream_options` (Google его не поддерживает, а usage отдаёт и так);
 *  - пустой content у assistant с tool_calls заменяем пробелом (пустая часть
 *    недопустима), у tool-результата — «(пусто)»;
 *  - `parallel_tool_calls` тоже убираем, если когда-нибудь появится.
 * Ключи/заголовки не трогаем.
 */

export function isGoogleEndpoint(baseUrl?: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(String(baseUrl ?? ""));
}

export function sanitizeGoogleBody<T extends Record<string, any>>(body: T): T {
  const out: Record<string, any> = { ...body };
  delete out.stream_options;
  delete out.parallel_tool_calls;
  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map((m: any) => {
      if (!m || typeof m !== "object") return m;
      const empty = typeof m.content !== "string" || m.content.trim() === "";
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && empty) {
        // Gemini считает пустую (и даже пробельную) часть недопустимой, а
        // content для вызова инструмента ему не нужен вовсе — убираем поле.
        const { content, ...rest } = m;
        return rest;
      }
      if (m.role === "tool" && empty) {
        return { ...m, content: "(пусто)" };
      }
      return m;
    });
  }
  return out as T;
}
