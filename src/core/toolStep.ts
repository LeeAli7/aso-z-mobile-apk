/**
 * Один шаг инструментов (I-7 + I-8, как в OpenCode).
 *
 * I-7: все вызовы шага идут одновременно — три независимых чтения стоят один
 * круг к модели, а не три. Результаты возвращаются в порядке вызовов.
 *
 * I-8: битые аргументы и упавший инструмент — это РЕЗУЛЬТАТ, а не исключение.
 * Причина уезжает модели внутри tool-сообщения, поэтому она исправляется в том
 * же шаге; отдельного user-сообщения (и лишнего запроса) больше нет.
 */

export type StepCall = { id: string; name: string; arguments: string };

export type StepResult = {
  call: StepCall;
  ok: boolean;
  /** Вызов битый (кривые аргументы / чужое имя) — модели нужно исправить вызов. */
  broken: boolean;
  result: string;
};

/** Как parseToolArgs, но с причиной: пустые/кривые аргументы не проглатываются. */
export function parseToolArgsSafe(raw: string): { args: Record<string, unknown>; error?: string } {
  const s = (raw ?? "").trim();
  if (!s) return { args: {}, error: "пустые аргументы" };
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { args: {}, error: "аргументы должны быть JSON-объектом" };
    }
    return { args: obj as Record<string, unknown> };
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    return { args: {}, error: `невалидный JSON (${msg.slice(0, 120)})` };
  }
}

const BROKEN_RESULT_RE = /does not exist|не хватило аргументов|не удалось разобрать|invalid json|unexpected token/i;

export async function runToolStep(
  calls: StepCall[],
  opts: {
    execute: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; result: string }>;
    known: (name: string) => boolean;
    onCall?: (c: StepCall) => void;
    /** Результат готов — отдаём в интерфейс сразу, не дожидаясь остальных. */
    onResult?: (r: StepResult) => void;
  },
): Promise<StepResult[]> {
  const finish = (r: StepResult): StepResult => {
    try { opts.onResult?.(r); } catch {}
    return r;
  };
  return Promise.all(
    calls.map(async (call): Promise<StepResult> => {
      opts.onCall?.(call);
      const parsed = parseToolArgsSafe(call.arguments);
      if (parsed.error) {
        return finish({ call, ok: false, broken: true, result: `Вызов не выполнен: ${parsed.error}.` });
      }
      try {
        const res = await opts.execute(call.name, parsed.args);
        // Провал команды (exit 1) — это результат работы, а не битый вызов.
        const broken = !res.ok && (!opts.known(call.name) || BROKEN_RESULT_RE.test(res.result));
        return finish({ call, ok: res.ok, broken, result: res.result });
      } catch (e: unknown) {
        return finish({
          call,
          ok: false,
          broken: false,
          result: `Инструмент упал: ${String((e as Error)?.message ?? e).slice(0, 300)}`,
        });
      }
    }),
  );
}
