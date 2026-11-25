/**
 * history.ts — нормализация tool-истории перед отправкой модели.
 *
 * Провайдеры (и OpenAI-совместимые, и Gemini через прокси) требуют: каждое
 * сообщение `role: "tool"` должно отвечать на `tool_calls` ПРЕДЫДУЩЕГО
 * assistant. Наша история обрезается (`slice(-30)`), поэтому пара легко
 * рвётся: остаются tool-ответы без assistant — и запрос падает 400
 * «Messages with role 'tool' must be a response to a preceding message with
 * 'tool_calls'».
 */

export type AnyMsg = { role?: string; content?: unknown; tool_calls?: any[]; tool_call_id?: string; [k: string]: any };

export function sanitizeToolHistory<T extends AnyMsg>(list: T[]): T[] {
  const out: AnyMsg[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || typeof m !== "object") continue;

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // подряд идущие tool-ответы сразу за assistant
      const got: AnyMsg[] = [];
      let j = i + 1;
      while (j < list.length && list[j]?.role === "tool") {
        got.push(list[j]);
        j++;
      }
      const answered = m.tool_calls.filter((c) => got.some((g) => g.tool_call_id === c?.id));
      if (answered.length === m.tool_calls.length) {
        // пара целая: отдаём assistant и его tool-ответы
        out.push(m);
        for (const g of got) out.push(g);
      } else if (String(m.content ?? "").trim()) {
        // ответы потеряны — оставляем хотя бы текст, без tool_calls
        out.push({ role: "assistant", content: m.content });
      }
      i = j - 1;
      continue;
    }

    // одиночный tool без assistant с tool_calls — выбрасываем
    if (m.role === "tool") continue;

    out.push(m);
  }
  return out as T[];
}
