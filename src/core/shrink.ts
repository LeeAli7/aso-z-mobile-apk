/**
 * Ужатие истории под потолок токенов в минуту, который назвал провайдер.
 * Отдельный модуль без react-native — чтобы его можно было проверять тестами.
 */
import { sanitizeToolHistory } from "./history";

/**
 * После обрезки могли остаться tool-ответы без своего assistant (и наоборот).
 * Провайдер отвечает на такое 400, поэтому чиним пары вручную:
 * assistant остаётся только с теми вызовами, чьи результаты дошли.
 */
function repairPairs(ms: any[]): any[] {
  const out: any[] = [];
  let i = 0;
  while (i < ms.length) {
    const m = ms[i];
    if (m.role === "tool") {
      i++; // без предшественника — выбрасываем
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const results: any[] = [];
      let j = i + 1;
      while (j < ms.length && ms[j].role === "tool") {
        results.push(ms[j]);
        j++;
      }
      const ids = new Set(results.map((r) => r.tool_call_id));
      const keep = m.tool_calls.filter((c: any) => ids.has(c.id));
      if (!keep.length) {
        const txt = typeof m.content === "string" ? m.content : "";
        if (txt.trim()) out.push({ role: "assistant", content: txt });
      } else {
        out.push({ ...m, tool_calls: keep });
        for (const r of results) if (keep.some((c: any) => c.id === r.tool_call_id)) out.push(r);
      }
      i = j;
      continue;
    }
    out.push(m);
    i++;
  }
  return out;
}


/**
 * Ужать историю под названный потолок токенов в минуту.
 * Сначала сокращаем выводы инструментов, потом выбрасываем середину, но НАЧАЛО
 * (системный промпт и исходную просьбу) не трогаем — иначе модель теряет задачу
 * и отвечает так, будто чат только что начался.
 */
export function shrinkMessages(messages: any[], maxTokens: number): any[] {
  const target = Math.max(2_000, Math.floor(maxTokens * 3.1)); // запас под ответ и разметку
  const size = (ms: any[]) =>
    ms.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 1_500), 0);
  if (size(messages) <= target) return messages;

  const ms = messages.map((m) =>
    m.role === "tool" && typeof m.content === "string" && m.content.length > 900
      ? { ...m, content: m.content.slice(0, 900) + "\n…(сокращено из-за лимита токенов провайдера)" }
      : m,
  );
  if (size(ms) <= target) return repairPairs(sanitizeToolHistory(ms));

  const head = ms.slice(0, Math.min(4, ms.length));
  let tail = ms.slice(-10);
  if (size([...head, ...tail]) > target) tail = tail.slice(-6);
  if (size([...head, ...tail]) > target) tail = tail.slice(-3);
  return repairPairs(sanitizeToolHistory([...head, ...tail]));
}

