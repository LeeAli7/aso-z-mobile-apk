/**
 * delegation.ts — субагенты (как Hermes delegate_task).
 *
 * Модель вызывает тул `delegate_task` с задачами; движок запускает
 * параллельные агентские ходы (streamAgentChat) с отдельным контекстом
 * и возвращает результаты модели. На телефоне параллелизм ограничен
 * 2 одновременными запросами (лёгкие freemium-модели), всё остальное — очередь.
 */
import { ModelInfo, ChatMessage, ChatPart } from "./gateway";

export interface DelegateTask {
  goal: string;
  context?: string;
  toolsets?: string[];
}

export interface DelegateResult {
  goal: string;
  ok: boolean;
  text: string;
  error?: string;
}

const MAX_CONCURRENT = 2;
const MAX_PARALLEL_TASKS = 6;

/**
 * Запустить N субагентов параллельно (лимит 2 одновременно, остальные в очереди).
 * Каждый субагент — это отдельный агентский ход (function calling) с тем же
 * системным промптом, но со своим узким goal.
 */
export async function runDelegation(
  model: ModelInfo,
  tasks: DelegateTask[],
  signal?: AbortSignal,
): Promise<DelegateResult[]> {
  const valid = (tasks || []).filter((t) => t?.goal?.trim()).slice(0, MAX_PARALLEL_TASKS);
  if (valid.length === 0) return [];

  const results: (DelegateResult | null)[] = valid.map(() => null);
  let cursor = 0;
  const workers: Promise<void>[] = [];

  const runOne = async (): Promise<void> => {
    while (cursor < valid.length) {
      const idx = cursor;
      cursor += 1;
      const task = valid[idx];
      results[idx] = await runSubAgent(model, task, signal);
    }
  };

  const n = Math.min(MAX_CONCURRENT, valid.length);
  for (let i = 0; i < n; i++) workers.push(runOne());
  await Promise.all(workers);

  return results.filter((r): r is DelegateResult => r !== null);
}

async function runSubAgent(
  model: ModelInfo,
  task: DelegateTask,
  signal?: AbortSignal,
): Promise<DelegateResult> {
  // динамический импорт — разрывает цикл gateway → tools → delegation → gateway
  const { streamAgentChat } = await import("./gateway");
  const ctx: ChatMessage = {
    role: "user",
    content: [
      { type: "text", text: `[СУБАГЕНТ] Выполни задачу самостоятельно.\nЦель: ${task.goal}` },
      ...(task.context ? [{ type: "text" as const, text: `\nКонтекст:\n${task.context}` }] : []),
    ],
  };

  let text = "";
  try {
    await streamAgentChat(
      model,
      [ctx],
      EMPTY_TOOLS,
      {
        onToken: (t: string) => { text += t; },
        onDone: () => {},
        onError: () => {},
      },
      signal,
    );
    // субагент не должен использовать тулы — только прямой ответ (легче и быстрее)
    return { goal: task.goal, ok: true, text: text.slice(0, 8000) };
  } catch (e: any) {
    if (signal?.aborted) return { goal: task.goal, ok: false, text: "", error: "aborted" };
    return { goal: task.goal, ok: false, text: "", error: String(e?.message || e) };
  }
}

/** Субагенты работают БЕЗ тулов (просто ответ) — быстрее и стабильнее на телефоне. */
const EMPTY_TOOLS: { type: "function"; function: unknown }[] = [];

/** Формат для модели: сводка результатов. */
export function formatDelegationResults(results: DelegateResult[]): string {
  if (results.length === 0) return "Нет результатов.";
  return results
    .map((r, i) => {
      const head = `${i + 1}. ${r.goal}`;
      if (!r.ok) return `${head}\n   [ошибка] ${r.error || "неизвестно"}`;
      return `${head}\n   ${r.text.slice(0, 3000) || "(пусто)"}`;
    })
    .join("\n" + "─".repeat(20) + "\n");
}

export { MAX_CONCURRENT, MAX_PARALLEL_TASKS };