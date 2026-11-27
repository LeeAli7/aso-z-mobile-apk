/**
 * Потолок ответа модели из справочника провайдера (/models).
 *
 * Разные API кладут его в разные поля:
 *  - OpenRouter: top_provider.max_completion_tokens (и context_length рядом)
 *  - Groq / vLLM: context_length
 *  - OpenAI-совместимые: max_completion_tokens / max_output_tokens
 * Возвращаем null, если провайдер ничего не сказал — тогда работаем на 8192.
 */
export function pickMaxOut(json: any, id: string): number | null {
  const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const hit = list.find((m) => m && m.id === id) ?? null;
  if (!hit) return null;
  const n = Number(
    hit.max_completion_tokens ??
      hit.max_output_tokens ??
      hit.top_provider?.max_completion_tokens ??
      hit.context_length ??
      0,
  );
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(8192, Math.max(1024, Math.floor(n)));
}
