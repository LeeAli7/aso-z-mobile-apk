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
import { checkDangerousCommand, isLongRunningCommand, runCommandBackground, runCommandCapture, runtimeAvailable } from "./runtime";
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

/** OpenAI-формат тулов для payload.
 * Фаза 1: фильтр по включённым тулсетам — выключенные сеты модели не отдаём.
 * tools.ts не импортирует toolsets.ts напрямую (цикл) — фильтр через dynamic import,
 * при ошибке отдаём всё (fail-open, как раньше). Self-review/субагенты используют getToolDefsFor. */
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

/** Асинхронная версия с тулсет-гейтом: только тулы включённых сетов. */
export async function getToolDefsGated(): Promise<Array<{ type: "function"; function: unknown }>> {
  const all = getToolDefs();
  try {
    const { enabledTools } = await import("./toolsets");
    const allowed = new Set(await enabledTools());
    return all.filter((t) => allowed.has((t.function as { name: string }).name));
  } catch {
    return all;
  }
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

/** Исполнить тул (Hermes: ошибки тоже возвращаются модели, агент продолжает).
 * Фаза 1: тулсет-гейт — тул выключенного сета не исполняется (модель могла
 * получить все дефы: ChatScreen зовёт синхронный getToolDefs()).
 * Фаза 2: approvals опасных команд + redact секретов в результате. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; result: string }> {
  const spec = registry.get(name);
  if (!spec) {
    return { ok: false, result: `Tool '${name}' does not exist. Available tools: ${toolNames().join(", ")}` };
  }
  // ── Тулсет-гейт ──
  try {
    const { enabledTools } = await import("./toolsets");
    const allowed = await enabledTools();
    if (!allowed.includes(name)) {
      return { ok: false, result: `Тулсет с тулом '${name}' выключен в настройках. Скажи пользователю включить его.` };
    }
  } catch {}
  // ── Approvals опасных команд (Hermes: approvals.mode) ──
  if (name === "run_command") {
    try {
      const { loadAgentConfig } = await import("./agentConfig");
      const cfg = await loadAgentConfig();
      const cmd = String((args as Record<string, unknown>)?.command ?? "");
      if (cfg.approvalsMode !== "off" && isDangerousCommand(cmd)) {
        const { loadSecurity } = await import("./security");
        const sec = await loadSecurity().catch(() => ({ confirmDangerous: true }) as { confirmDangerous: boolean });
        if (sec.confirmDangerous) {
          return { ok: false, result: `Опасная команда «${cmd.slice(0, 120)}» требует подтверждения пользователя (approvals: ${cfg.approvalsMode}). Спроси пользователя явно, выполнять ли её, и дождись согласия.` };
        }
      }
    } catch {}
  }
  try {
    const result = await spec.handler(args ?? {}, ctx);
    // ── Redact секретов (Hermes: security.redact_secrets, on by default) ──
    try {
      const { loadSecurity } = await import("./security");
      const sec = await loadSecurity().catch(() => ({ redactSecrets: true }) as { redactSecrets: boolean });
      if (sec.redactSecrets) return { ok: true, result: redactSecrets(result) };
    } catch {}
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, result: `Error in tool '${name}': ${String(e?.message || e)}` };
  }
}

/** Опасная команда (Hermes: destructive-flag): rm -rf, форматирование, сброс git. */
function isDangerousCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase();
  if (!c) return false;
  return (
    /rm\s+(-[^ ]*r[^ ]*\s+(-[^ ]*\s+)*(\/|\*|~|\$home|\$prefix)|-rf?\s+\/)/.test(c) ||
    c.includes("mkfs") ||
    c.includes(":(){") ||
    /git\s+reset\s+--hard/.test(c) ||
    /git\s+clean\s+-f/.test(c) ||
    /del\s+\/[fs]/.test(c) ||
    /format\s+[a-z]:/.test(c)
  );
}

/** Замазать секреты в выводе (ключи, токены, Bearer). */
function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "sk-***")
    .replace(/(ghp_[A-Za-z0-9_]{8,})/g, "ghp_***")
    .replace(/(gho_[A-Za-z0-9_]{8,})/g, "gho_***")
    .replace(/(xox[bap]-[A-Za-z0-9-]+)/g, "xox-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1***")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?)([^'"\s,}]{8,})/gi, "$1***");
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
    "Выполнить команду в терминале на устройстве пользователя (встроенный Linux: основной режим — Termux с apt (apt update/apt install, репозиторий packages.termux.dev; apt видит путь /data/data/com.termux/files/usr через проot-маппер — это нормально), запасной — Alpine rootfs с apk (apk add). python3 уже установлен). Вывод команды вернётся как результат. Не запускай интерактивные программы " +
    "(vim, nano, top) — только однократные команды. Пакеты ставь штатным менеджером среды: в основном режиме это `apt install <пакет>` " +
    "(Termux, root-права есть; обновление списков — `apt update`), в запасном Alpine-режиме — `apk add <пакет>`. " +
    "Сначала проверь доступный менеджер: `command -v apt || command -v apk`. " +
    "Python-пакеты — `pip install <пакет>` (при отсутствии pip: `apt install python-pip` или `apk add py3-pip`). " +
    "Используй, когда нужно: проверить файлы/систему, установить пакет, собрать или запустить что-то, " +
    "прочитать результат выполнения. Команды выполняются по одной; дожидайся вывода. " +
    "Долгие процессы (дев-сервер, локальный холст, vite/next/http.server, watch-режим) НЕ жди: они не завершаются. " +
    "Для них передавай background=true — процесс поднимется в фоне, вернутся pid и первые строки вывода (порт/адрес). " +
    "Обычная команда ограничена тайм-аутом (по умолчанию 120 с, можно изменить через timeout_ms); " +
    "если команда не уложилась — она останавливается и возвращается честная ошибка, а не вечное ожидание.",
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
      background: {
        type: "boolean",
        description: "true — запустить как долгий процесс (сервер/холст/watch) и не ждать завершения",
      },
      timeout_ms: {
        type: "number",
        description: "Тайм-аут выполнения в миллисекундах (по умолчанию 120000, максимум 600000)",
      },
    },
    required: ["command"],
  },
  handler: async (args, ctx): Promise<string> => {
    const cmd = String(args.command ?? "").trim();
    if (!cmd) return "ошибка: пустая команда";
    if (!runtimeAvailable()) return "рантайм доступен только на Android";
    // Катастрофические команды не запускаем вообще (не диалог, а отказ):
    // агент не должен уметь форматировать диск или стирать корень.
    const danger = checkDangerousCommand(cmd);
    if (danger) {
      return `Команда заблокирована: ${danger}.\n$ ${cmd}\nЕсли это действительно нужно — выполни вручную в терминале приложения.`;
    }
    const cwdArg = args.cwd ? String(args.cwd) : ctx.cwd;

    // Долгие процессы: сервер/холст/watch никогда не завершаются сами.
    // Раньше такая команда держала чат в ожидании до сетевого тайм-аута и
    // «падала с ошибкой», хотя сервер был уже поднят. Теперь — в фон.
    const wantBg = args.background === true || isLongRunningCommand(cmd);
    if (wantBg) {
      const bg = await runCommandBackground(cmd, cwdArg);
      if (!bg.ok) {
        const detail = bg.output?.trim() || bg.error || "нет вывода";
        return `Не удалось запустить в фоне\n$ ${cmd}\n${detail.slice(0, 3000)}`;
      }
      const lines = bg.output
        ? `\nВывод (первые строки):\n${bg.output.slice(-2000)}`
        : "\nВывод пока пуст — процесс только стартовал.";
      return (
        `Процесс запущен в фоне и НЕ блокирует чат.\n` +
        `$ ${cmd}\n` +
        `pid: ${bg.pid ?? "?"}, сессия: ${bg.sessionId}\n` +
        (bg.ready ? "Готовность: сервер сообщил адрес/порт.\n" : "Готовность: пока не сообщил порт (возможен запуск).\n") +
        lines
      );
    }

    const timeout = Math.min(600_000, Math.max(5_000, Number(args.timeout_ms) || 120_000));
    const r = await runCommandCapture(cmd, ctx.projectId, cwdArg, 4000, timeout);
    if (r.ok) {
      const out = r.output?.trim();
      return out
        ? `Вывод команды: exit 0\n$ ${cmd}\n${out.slice(0, 6000)}`
        : `Команда выполнена (exit 0). Вывод пуст.\n$ ${cmd}`;
    }
    if (r.timedOut) {
      const partial = r.output?.trim();
      return (
        `Команда остановлена по тайм-ауту (${Math.round(timeout / 1000)} с) — похоже, это долгий процесс.\n` +
        `$ ${cmd}\n` +
        (partial ? `Что успело вывестись:\n${partial.slice(-2000)}\n` : "") +
        `Повтори с background=true, чтобы запустить её в фоне и не блокировать чат.`
      );
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
    const r = await runCommandCapture(`ls -la "${p}" 2>&1`, ctx.projectId, ctx.cwd);
    return r.ok ? (r.output?.trim() || "(пусто)").slice(0, 6000) : `ошибка: ${r.error || `exit ${r.code}`}`;
  },
});

/* ── Проверка путей ──────────────────────────────────────────────────────────
 * Пути подставляются в shell-команды, поэтому: (1) не даём символам ломать
 * команду, (2) не пускаем агента в системные каталоги, где правки ломают
 * рантайм. Рабочие папки пользователя (Downloads, $HOME, проект) разрешены.
 */
function pathProblem(p: string): string | null {
  if (!p) return "ошибка: нужен путь";
  if (/["`$;|&\n\r]/.test(p)) return "ошибка: в пути есть недопустимые символы";
  // нормализуем: иначе "sub/../../data/x" проходил мимо блок-листа
  const norm = "/" + p
    .replace(/^~\/?/, "")
    .split("/")
    .reduce<string[]>((acc, part) => {
      if (!part || part === ".") return acc;
      if (part === "..") { acc.pop(); return acc; }
      acc.push(part);
      return acc;
    }, [])
    .join("/");
  const blocked = ["/data/", "/system/", "/proc/", "/dev/", "/sys/"];
  if (blocked.some((b) => norm.startsWith(b) || norm === b.slice(0, -1))) return "ошибка: системный путь защищён";
  if (norm.includes("/../")) return "ошибка: выход за пределы каталога запрещён";
  return null;
}

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
    const bad = pathProblem(p);
    if (bad) return bad;
    // limit=8000: иначе рантайм режет файл на 4000 и обещание «до 8000» не выполнялось
    const r = await runCommandCapture(`cat "${p}" 2>&1`, ctx.projectId, ctx.cwd, 8600);
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
    const bad = pathProblem(p);
    if (bad) return bad;
    if (content.length > 200_000) return "ошибка: файл слишком большой (лимит 200 КБ)";
    const b64 = utf8ToBase64(content);
    const r = await runCommandCapture(
      `mkdir -p "$(dirname "${p}")" && echo ${b64} | base64 -d > "${p}" && wc -c "${p}"`,
      ctx.projectId,
      ctx.cwd,
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

/* ── Тул: поиск по прошлым диалогам (Hermes session_search) ─────────────── */

registerTool({
  name: "session_search",
  description:
    "Поиск по прошлым диалогам (названия сессий + текст сообщений). " +
    "Используй, когда пользователь ссылается на прошлый разговор.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Поисковый запрос" },
      limit: { type: "string", description: "Макс. результатов (по умолчанию 5)" },
    },
    required: ["query"],
  },
  handler: async (args): Promise<string> => {
    const q = String(args.query ?? "").trim();
    if (!q) return "ошибка: пустой запрос";
    const lim = Math.max(1, Math.min(20, parseInt(String(args.limit ?? "5"), 10) || 5));
    const { searchSessions } = await import("./sessions");
    const hits = await searchSessions(q, lim);
    if (!hits.length) return "Ничего не найдено.";
    return hits
      .map((s, i) => {
        const last = Array.isArray(s.messages) && s.messages.length
          ? String((s.messages[s.messages.length - 1] as any)?.content ?? "").slice(0, 200)
          : "";
        return `${i + 1}. ${s.name} (${new Date(s.updatedAt).toLocaleDateString()})${last ? `\n   …${last}` : ""}`;
      })
      .join("\n");
  },
});

/* ── MCP: подключённые серверы реально доступны агенту ───────────────
 * До этого `aso_mcp_servers` только хранился в настройках: агент о нём
 * не знал. Теперь можно посмотреть инструменты сервера и вызвать любой
 * из них (Streamable HTTP, JSON-RPC 2.0). */
registerTool({
  name: "mcp",
  description:
    "Работа с MCP-серверами из раздела «Коннекторы». action=list — список серверов, " +
    "action=tools — инструменты сервера (server_id), action=call — вызвать инструмент " +
    "(server_id, tool, args). Поддерживаются HTTP-серверы; stdio (npx/uvx) на телефоне недоступен.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "list | tools | call" },
      server_id: { type: "string", description: "id сервера (из action=list)" },
      tool: { type: "string", description: "имя инструмента MCP" },
      args: { type: "object", description: "аргументы инструмента" },
    },
    required: ["action"],
  },
  handler: async (args): Promise<string> => {
    const { listMcpServers } = await import("./connectors");
    const action = String(args.action ?? "list");
    if (action === "list") {
      const list = await listMcpServers();
      if (!list.length) return "MCP-серверы не добавлены (Коннекторы → MCP-серверы).";
      return list
        .map((s) => `• ${s.name} [${s.id}] ${s.transport ?? "stdin"} ${s.enabled ? "вкл" : "выкл"} ${s.url ?? s.command ?? ""}`)
        .join("\n");
    }
    const id = String(args.server_id ?? "").trim();
    if (!id) return "ошибка: нужен server_id";
    const { mcpTools, mcpCall } = await import("./mcp");
    if (action === "tools") {
      const r = await mcpTools(id);
      if (!r.ok) return `ошибка: ${r.message}`;
      if (!r.tools.length) return "У сервера нет инструментов.";
      return r.tools.map((t) => `• ${t.name}${t.description ? " — " + t.description : ""}`).join("\n");
    }
    if (action === "call") {
      const tool = String(args.tool ?? "").trim();
      if (!tool) return "ошибка: нужен tool";
      const r = await mcpCall(id, tool, (args.args as Record<string, unknown>) ?? {});
      return r.ok ? (r.content || "готово") : `ошибка: ${r.message}`;
    }
    return "ошибка: action = list | tools | call";
  },
});
