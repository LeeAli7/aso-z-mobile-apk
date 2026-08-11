/**
 * tools.ts — реестр тулов агента (как registry в Hermes).
 *
 * Модели объявляются JSON-Schema тулы в payload (`tools: [{type:"function",...}]`),
 * модель возвращает tool_calls, движок исполняет через handler и возвращает
 * результат модели сообщением {role:"tool"} — это и есть настоящий function calling.
 *
 * Тулы: run_command (терминал), read_file/write_file/list_files (vibe-ФС),
 * memory (память), todo (задачи), skill_view/skill_manage (навыки),
 * web_search (поиск), session_search (прошлые диалоги), delegate_task (субагенты).
 */
import { runCommandCapture, runtimeAvailable } from "./runtime";
import { runMemoryOps, memorySnapshot, MemoryOp } from "./memory";
import { runTodoOps, TodoOp } from "./todo";
import { listSkills, viewSkill, saveSkill, deleteSkill } from "./skills";
import { webSearch, formatSearchResults } from "./webSearch";
import { runDelegation, DelegateTask, formatDelegationResults } from "./delegation";

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
  /** Колбэк для длинных тулов (delegation) — статус в UI. */
  onProgress?: (msg: string) => void;
  model?: any;
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

/** Только выбранные тулы (whitelist — для self-improve/субагентов). */
export function getToolDefsFor(names: string[]): Array<{ type: "function"; function: unknown }> {
  return names
    .map((n) => registry.get(n))
    .filter((t): t is ToolSpec => !!t)
    .map((t) => ({
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

function firstArg(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (typeof args[k] === "string" && (args[k] as string).trim()) return (args[k] as string).trim();
  }
  return "";
}

/** UTF-8 → base64 без Buffer (RN-safe). */
export function utf8ToBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    const b64 = btoa(
      unescape(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))),
    );
    return b64;
  }
}

/* ── Тул: терминал ──────────────────────────────────────────────────────── */

registerTool({
  name: "run_command",
  description:
    "Выполнить команду в терминале на устройстве пользователя (встроенный Linux как в Termux: bash, python3, pip, apt, git " +
    "и стандартные утилиты — python3 уже установлен). Вывод команды вернётся как результат. Не запускай интерактивные программы " +
    "(vim, nano, top) — только однократные команды. Пакеты ставь через apt install (sudo не нужен). " +
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
    const detail = r.output?.trim() || r.error || `exit ${r.code}`;
    return `Команда не выполнена (exit ${r.code ?? -1})\n$ ${cmd}\n${detail.slice(0, 3000)}`;
  },
});

/* ── Тулы: файлы (vibe-ФС через терминал) ───────────────────────────────── */

function envHome(prefix: string): string {
  return `${prefix}/home`;
}

registerTool({
  name: "list_files",
  description:
    "Список файлов в директории проекта/рабочей области пользователя. " +
    "Используй, чтобы узнать структуру файлов перед чтением или изменением.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Путь к директории (относительный путь проекта или абсолютный). Без пути — корень проекта.",
      },
    },
  },
  handler: async (args, ctx): Promise<string> => {
    if (!runtimeAvailable()) return "рантайм доступен только на Android";
    const p = String(args.path ?? "").trim() || ctx.cwd || ".";
    // защита от выхода за пределы: разрешаем относительные пути и $HOME
    if (p.startsWith("/data") || p.startsWith("../") || p.includes("..\\")) {
      return "ошибка: разрешены только относительные пути или $HOME";
    }
    const r = await runCommandCapture(`ls -la "${p}" 2>&1`, ctx.projectId);
    return r.ok ? (r.output?.trim() || "(пусто)").slice(0, 6000) : `ошибка: ${r.error || `exit ${r.code}`}`;
  },
});

registerTool({
  name: "read_file",
  description:
    "Прочитать содержимое файла (текст). Используй для кода, конфигов, заметок. Возвращает до 8000 символов.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Путь к файлу (относительный путь проекта или абсолютный).",
      },
    },
    required: ["path"],
  },
  handler: async (args, ctx): Promise<string> => {
    if (!runtimeAvailable()) return "рантайм доступен только на Android";
    const p = String(args.path ?? "").trim();
    if (!p) return "ошибка: нужен путь";
    const r = await runCommandCapture(`cat "${p}" 2>&1`, ctx.projectId);
    if (!r.ok) return `ошибка чтения: ${r.error || r.output || `exit ${r.code}`}`;
    const out = r.output ?? "";
    return out.length > 8000 ? out.slice(0, 8000) + `\n… (обрезано, всего ${out.length} симв.)` : out;
  },
});

registerTool({
  name: "write_file",
  description:
    "Создать или перезаписать файл с текстовым содержимым. Используй для кода, конфигов, заметок. " +
    "Передай содержимое в поле content (не экранируй переводы строк вручную).",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Путь к файлу (относительный путь проекта или абсолютный).",
      },
      content: {
        type: "string",
        description: "Полное содержимое файла.",
      },
    },
    required: ["path", "content"],
  },
  handler: async (args, ctx): Promise<string> => {
    if (!runtimeAvailable()) return "рантайм доступен только на Android";
    const p = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    if (!p) return "ошибка: нужен путь";
    if (content.length > 200_000) return "ошибка: файл слишком большой (лимит 200 КБ)";
    const b64 = utf8ToBase64(content);
    const r = await runCommandCapture(
      `mkdir -p "$(dirname "${p}")" && echo ${b64} | base64 -d > "${p}" && wc -c "${p}"`,
      ctx.projectId,
    );
    return r.ok ? `Файл записан: ${p} (${content.length} симв.).` : `ошибка записи: ${r.error || r.output || `exit ${r.code}`}`;
  },
});

/* ── Тул: память ────────────────────────────────────────────────────────── */

registerTool({
  name: "memory",
  description:
    "Память агента. Сохраняет факты о пользователе (target=user) или рабочие заметки/конвенции (target=memory). " +
    "Используй, когда пользователь сообщил важный факт о себе/своих предпочтениях/правилах — сохрани это, " +
    "чтобы помнить в будущих сессиях. Операции: add (добавить), replace (заменить по old_text), remove (удалить по old_text). " +
    "Можно передать массив операций в одном вызове.",
  parameters: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        description: "Массив операций с памятью",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "replace", "remove"] },
            target: { type: "string", enum: ["user", "memory"], description: "куда: user=факты о пользователе, memory=заметки" },
            content: { type: "string", description: "Текст для add/replace" },
            old_text: { type: "string", description: "Фрагмент для поиска при replace/remove" },
          },
          required: ["action"],
        },
      },
    },
    required: ["operations"],
  },
  handler: async (args): Promise<string> => {
    const ops = Array.isArray(args.operations) ? (args.operations as MemoryOp[]) : [];
    return runMemoryOps(ops);
  },
});

/* ── Тул: todo ──────────────────────────────────────────────────────────── */

registerTool({
  name: "todo",
  description:
    "Планировщик задач агента. Создавай задачи, когда пользователь просит что-то сделать позже или " +
    "когда работа состоит из нескольких шагов. Операции: add (создать с content), update (изменить статус по id: " +
    "pending/in_progress/completed/cancelled), remove (удалить по id), list (показать все).",
  parameters: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "update", "remove", "list"] },
            content: { type: "string", description: "Текст задачи для add" },
            id: { type: "string", description: "id задачи для update/remove" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
          },
          required: ["action"],
        },
      },
    },
    required: ["operations"],
  },
  handler: async (args): Promise<string> => {
    const ops = Array.isArray(args.operations) ? (args.operations as TodoOp[]) : [];
    return runTodoOps(ops);
  },
});

/* ── Тулы: навыки ───────────────────────────────────────────────────────── */

registerTool({
  name: "skill_view",
  description:
    "Просмотр навыков агента. Без аргументов — список всех навыков (имя + описание). " +
    "С аргументом name — полное содержимое навыка. Навыки = процедурная память: как делать класс задач. " +
    "Загружай навык, когда задача похожа на уже решённую ранее.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Имя навыка (необязательно: без него — список)" },
    },
  },
  handler: async (args): Promise<string> => {
    const name = String(args.name ?? "").trim();
    if (!name) {
      const list = await listSkills();
      if (list.length === 0) return "Навыков пока нет. Создай первый через skill_manage после успешной задачи.";
      return "Доступные навыки:\n" + list.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    }
    return viewSkill(name);
  },
});

registerTool({
  name: "skill_manage",
  description:
    "Управление навыками агента: создать/обновить (action=save) или удалить (action=delete). " +
    "После успешного выполнения сложной задачи (5+ шагов) сохрани подход как навык, чтобы не изобретать заново. " +
    "Имя: латиница/цифры/дефисы. Для save нужны: name, description (что делает, по чему искать), body (шаги/питфоллы).",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["save", "delete"] },
      name: { type: "string" },
      description: { type: "string" },
      body: { type: "string" },
    },
    required: ["action", "name"],
  },
  handler: async (args): Promise<string> => {
    const action = String(args.action ?? "");
    const name = String(args.name ?? "").trim();
    if (!name) return "ошибка: нужен name";
    if (action === "save") {
      return saveSkill(name, String(args.description ?? ""), String(args.body ?? ""));
    }
    if (action === "delete") return deleteSkill(name);
    return "ошибка: action должен быть save или delete";
  },
});

/* ── Тул: веб-поиск ─────────────────────────────────────────────────────── */

registerTool({
  name: "web_search",
  description:
    "Поиск в интернете (DuckDuckGo). Используй, когда нужны свежие факты, новости, документация, цены, " +
    "или когда не уверен в ответе. Возвращает до 5 результатов с заголовком, ссылкой и описанием.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Поисковый запрос" },
    },
    required: ["query"],
  },
  handler: async (args): Promise<string> => {
    const q = String(args.query ?? "").trim();
    if (!q) return "ошибка: пустой запрос";
    const r = await webSearch(q);
    if (!r.ok) return `Поиск не удался: ${r.error || "неизвестная ошибка"}`;
    return formatSearchResults(r.results);
  },
});

/* ── Тул: субагенты ─────────────────────────────────────────────────────── */

registerTool({
  name: "delegate_task",
  description:
    "Запустить субагентов для параллельной работы (как в Hermes). " +
    "Используй для независимых подзадач: собрать факты по нескольким темам, изучить несколько файлов, " +
    "сравнить варианты. Каждый субагент получает свою цель; результаты вернутся сводкой. " +
    "Максимум 6 задач, параллельно до 2. Субагенты работают без инструментов — только прямой ответ.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Цель субагента (конкретная, самостоятельная задача)" },
            context: { type: "string", description: "Дополнительный контекст (необязательно)" },
          },
          required: ["goal"],
        },
      },
    },
    required: ["tasks"],
  },
  handler: async (args, ctx): Promise<string> => {
    const tasks = Array.isArray(args.tasks) ? (args.tasks as DelegateTask[]) : [];
    if (tasks.length === 0) return "ошибка: пустой список задач";
    if (!ctx.model) return "ошибка: делегирование недоступно в этом контексте";
    ctx.onProgress?.(`Запускаю ${Math.min(tasks.length, 6)} субагентов…`);
    const results = await runDelegation(ctx.model, tasks);
    return formatDelegationResults(results);
  },
});

/* ── Тул: снапшот памяти (системный, для diagnostics) ───────────────────── */

registerTool({
  name: "memory_snapshot",
  description:
    "Внутренний: показать текущий снапшот памяти (факты о пользователе, заметки). " +
    "Используется для проверки, что память работает.",
  parameters: { type: "object", properties: {}, required: [] },
  handler: async (): Promise<string> => {
    const snap = await memorySnapshot();
    return snap || "Память пуста.";
  },
});