/**
 * memory.ts — память агента (как Hermes: MEMORY.md + USER.md).
 *
 * Два хранилища:
 *  - USER: кто пользователь (имя, роль, предпочтения, жёсткие правила)
 *  - MEMORY: рабочие заметки (окружение, конвенции, уроки)
 *
 * Записи инжектятся в системный промпт при старте сессии (снапшот),
 * агент может их читать/менять через тул `memory` (add/replace/remove/list).
 *
 * ВАЖНО (фикс 2026-10-22): раньше при переполнении записи МОЛЧА вытеснялись
 * (`kept.shift()`), а `replace` затирал всю запись целиком даже когда old_text
 * был лишь фрагментом — это была тихая потеря данных пользователя. Теперь:
 *  - переполнение = отказ, ничего не пишется, в ответе точный размер и подсказка;
 *  - replace: если old_text = вся запись → замена записи, иначе замена фрагмента
 *    внутри записи (остальное сохраняется);
 *  - счётчик символов считается той же функцией, что и лимит.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type MemoryTarget = "user" | "memory";

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

const KEYS = {
  user: "aso_mem_user",
  memory: "aso_mem_memory",
};

const CHAR_LIMIT = { user: 2200, memory: 2200 } as const;

function genId(): string {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function load(target: MemoryTarget): Promise<MemoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[target]);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MemoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Точный размер хранилища — одна функция и для лимита, и для отчёта. */
function sizeOf(arr: MemoryEntry[]): number {
  return arr.reduce((s, e) => s + (e.text?.length ?? 0), 0);
}

/**
 * Сохранить без вытеснения. Возвращает null при успехе или текст ошибки.
 */
async function save(target: MemoryTarget, entries: MemoryEntry[]): Promise<string | null> {
  const limit = CHAR_LIMIT[target];
  const size = sizeOf(entries);
  if (size > limit) {
    const over = size - limit;
    return (
      `ошибка: ${target} переполнена на ${over} симв. (${size}/${limit}) — НИЧЕГО не записано, ` +
      `старые записи не удалялись. Сократи запись или удали ненужное (memory {operations:[{action:"list"}]})`
    );
  }
  try {
    await AsyncStorage.setItem(KEYS[target], JSON.stringify(entries));
    return null;
  } catch (e) {
    return `ошибка записи памяти: ${String((e as Error)?.message ?? e)}`;
  }
}

/** Снапшот памяти для системного промпта (компактный, с лимитом символов). */
export async function memorySnapshot(): Promise<string> {
  const [user, mem] = await Promise.all([load("user"), load("memory")]);
  const parts: string[] = [];
  if (user.length) {
    parts.push(
      "ФАКТЫ О ПОЛЬЗОВАТЕЛЕ (проверено и сохранено ранее):\n" +
        user.map((e) => `- ${e.text}`).join("\n"),
    );
  }
  if (mem.length) {
    parts.push(
      "ЗАМЕТКИ/КОНВЕНЦИИ (из прошлых сессий):\n" +
        mem.map((e) => `- ${e.text}`).join("\n"),
    );
  }
  return parts.join("\n\n").slice(0, 4000);
}

/** Подробный список записей (для tool-операции list). */
export async function memoryList(): Promise<string> {
  const [user, mem] = await Promise.all([load("user"), load("memory")]);
  const fmt = (title: string, arr: MemoryEntry[], key: MemoryTarget) => {
    const size = sizeOf(arr);
    const head = `${title} (${size}/${CHAR_LIMIT[key]} симв., ${arr.length} записей):`;
    if (!arr.length) return `${head}\n  (пусто)`;
    return `${head}\n` + arr.map((e, i) => `  ${i + 1}. ${e.text}`).join("\n");
  };
  return [fmt("ФАКТЫ О ПОЛЬЗОВАТЕЛЕ (user)", user, "user"), fmt("ЗАМЕТКИ (memory)", mem, "memory")].join("\n\n");
}

export interface MemoryOp {
  action: "add" | "replace" | "remove" | "list";
  target?: MemoryTarget;
  content?: string;
  old_text?: string;
}

/**
 * Выполнить операции с памятью (тул агента).
 * Возвращает строку-отчёт для модели.
 */
export async function runMemoryOps(ops: MemoryOp[]): Promise<string> {
  if (!Array.isArray(ops) || ops.length === 0) {
    return (
      "ошибка: не передано ни одной операции. Формат: " +
      '[{"action":"add|replace|remove|list","target":"user|memory","content":"...","old_text":"..."}]'
    );
  }
  const reports: string[] = [];
  for (const op of ops) {
    const target: MemoryTarget = op.target === "user" ? "user" : "memory";
    const entries = await load(target);
    switch (op.action) {
      case "add": {
        if (!op.content || !op.content.trim()) {
          reports.push("add: нет content");
          continue;
        }
        const next: MemoryEntry[] = [
          ...entries,
          { id: genId(), text: op.content.trim(), createdAt: Date.now(), updatedAt: Date.now() },
        ];
        const err = await save(target, next);
        reports.push(err ?? `add → ${target}: записано (${sizeOf(next)}/${CHAR_LIMIT[target]} симв.)`);
        break;
      }
      case "replace": {
        if (!op.old_text || !op.content) {
          reports.push("replace: нужны old_text и content");
          continue;
        }
        const needle = op.old_text.trim();
        const idx = entries.findIndex((e) => e.text.includes(op.old_text!));
        if (idx < 0) {
          reports.push(`replace: не найдено «${needle.slice(0, 60)}» — ничего не изменено`);
          continue;
        }
        const cur = entries[idx].text;
        // old_text совпал со всей записью → меняем запись; иначе меняем ТОЛЬКО фрагмент,
        // чтобы длинная заметка не превращалась в огрызок
        const wholeEntry = cur.trim() === needle;
        const next = [...entries];
        next[idx] = {
          ...entries[idx],
          text: wholeEntry ? op.content.trim() : cur.replace(op.old_text!, op.content),
          updatedAt: Date.now(),
        };
        const err = await save(target, next);
        reports.push(
          err ??
            (wholeEntry
              ? `replace → ${target}: запись заменена`
              : `replace → ${target}: заменён фрагмент (остальная запись сохранена)`),
        );
        break;
      }
      case "remove": {
        if (!op.old_text) {
          reports.push("remove: нет old_text");
          continue;
        }
        const before = entries.length;
        const filtered = entries.filter((e) => !e.text.includes(op.old_text!));
        const err = await save(target, filtered);
        reports.push(err ?? `remove → ${target}: удалено ${before - filtered.length} шт.`);
        break;
      }
      case "list":
        reports.push(await memoryList());
        break;
      default:
        reports.push(`неизвестное действие: ${String(op.action)}`);
    }
  }
  const [u, m] = await Promise.all([load("user"), load("memory")]);
  const total = sizeOf(u) + sizeOf(m);
  const limit = CHAR_LIMIT.user + CHAR_LIMIT.memory;
  return `${reports.join("; ")}. Всего в памяти: ${total}/${limit} симв.`;
}

/** Удалить память (очистка в настройках). */
export async function clearMemory(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.user);
  await AsyncStorage.removeItem(KEYS.memory);
}

export { CHAR_LIMIT };
