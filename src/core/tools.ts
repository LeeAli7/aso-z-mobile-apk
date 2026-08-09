/**
 * tools.ts — реестр тулов агента (как registry в Hermes).
 *
 * Модели объявляются JSON-Schema тулы в payload (`tools: [{type:"function",...}]`),
 * модель возвращает tool_calls, движок исполняет через handler и возвращает
 * результат модели сообщением {role:"tool"} — это и есть настоящий function calling.
 *
 * Первый тул: run_command (терминал). Дальше: read_file, write_file, memory, todo…
 */
import { runCommandCapture, runtimeAvailable } from "./runtime";

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema параметров (properties/required). */
  parameters: Record<string, unknown>;
  /** Исполнение: возвращает строку-результат, которую увидит модель. */
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface ToolContext {
  projectId?: string;
  cwd?: string;
}

const registry = new Map<string, ToolSpec>();

export function registerTool(spec: ToolSpec): void {
  registry.set(spec.name, spec);
}

export function getTool(name: string): ToolSpec | undefined {
  return registry.get(name);
}

/** OpenAI-формат тулов для payload. */
export function getToolDefs(): Array<{ type: "function"; function: unknown }> {
  return [...registry.values()].map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toolNames(): string[] {
  return [...registry.keys()];
}

/** Исполнить тул (Hermes: ошибки тоже возвращаются модели, агент продолжает). */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; result: string }> {
  const spec = registry.get(name);
  if (!spec) {
    return { ok: false, result: `Tool '${name}' does not exist. Available tools: ${toolNames().join(", ")}` };
  }
  try {
    const result = await spec.handler(args ?? {}, ctx);
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, result: `Error in tool '${name}': ${String(e?.message || e)}` };
  }
}

/* ── Тул: терминал ──────────────────────────────────────────────────────── */

registerTool({
  name: "run_command",
  description:
    "Выполнить команду в терминале на устройстве пользователя (встроенный Linux: bash, apt, python, node " +
    "и стандартные утилиты). Вывод команды вернётся как результат. Не запускай интерактивные программы " +
    "(vim, nano, top) — только однократные команды. Пакеты ставь через apt (sudo не нужен). " +
    "Используй, когда нужно: проверить файлы/систему, установить пакет, собрать или запустить что-то, " +
    "прочитать результат выполнения. Команды выполняются по одной; дожидайся вывода.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Команда для выполнения (например: ls -la)",
      },
      cwd: {
        type: "string",
        description: "Рабочая директория (необязательно, по умолчанию HOME)",
      },
    },
    required: ["command"],
  },
  handler: async (args, ctx): Promise<string> => {
    const cmd = String(args.command ?? "").trim();
    if (!cmd) return "ошибка: пустая команда";
    if (!runtimeAvailable()) return "рантайм доступен только на Android";
    const r = await runCommandCapture(cmd, ctx.projectId, args.cwd ? String(args.cwd) : ctx.cwd);
    if (r.ok) {
      const out = r.output?.trim();
      return out
        ? `Вывод команды: exit 0\n$ ${cmd}\n${out.slice(0, 6000)}`
        : `Команда выполнена (exit 0). Вывод пуст.\n$ ${cmd}`;
    }
    // в r.output — сообщение bash с причиной (Permission denied / Exec format error…)
    const detail = r.output?.trim() || r.error || `exit ${r.code}`;
    return `Команда не выполнена (exit ${r.code ?? -1})\n$ ${cmd}\n${detail.slice(0, 3000)}`;
  },
});