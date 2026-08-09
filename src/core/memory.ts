/**
 * memory.ts — память агента (как Hermes: MEMORY.md + USER.md).
 *
 * Два хранилища:
 *  - USER: кто пользователь (имя, роль, предпочтения, жёсткие правила)
 *  - MEMORY: рабочие заметки (окружение, конвенции, уроки)
 *
 * Записи инжектятся в системный промпт при старте сессии (снапшот),
 * агент может их читать/менять через тул `memory` (add/replace/remove/batch).
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

async function save(target: MemoryTarget, entries: MemoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[target], JSON.stringify(entries.slice(-60)));
  } catch {
    // не критично
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

export interface MemoryOp {
  action: "add" | "replace" | "remove";
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
    return "ошибка: не передано ни одной операции. Формат: [{\"action\":\"add|replace|remove\",\"target\":\"user|memory\",\"content\":\"...\",\"old_text\":\"...\"}]";
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
        entries.push({
          id: genId(),
          text: op.content.trim(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await save(target, entries);
        reports.push(`add → ${target}: записано`);
        break;
      }
      case "replace": {
        if (!op.old_text || !op.content) {
          reports.push("replace: нужны old_text и content");
          continue;
        }
        const idx = entries.findIndex((e) => e.text.includes(op.old_text!));
        if (idx < 0) {
          reports.push(`replace: не найдено «${op.old_text.slice(0, 60)}»`);
          continue;
        }
        entries[idx] = { ...entries[idx], text: op.content.trim(), updatedAt: Date.now() };
        await save(target, entries);
        reports.push(`replace → ${target}: обновлено`);
        break;
      }
      case "remove": {
        if (!op.old_text) {
          reports.push("remove: нет old_text");
          continue;
        }
        const before = entries.length;
        const filtered = entries.filter((e) => !e.text.includes(op.old_text!));
        await save(target, filtered);
        reports.push(
          `remove → ${target}: удалено ${before - filtered.length} шт.`,
        );
        break;
      }
      default:
        reports.push(`неизвестное действие: ${String(op.action)}`);
    }
  }
  // итоговый размер
  const [u, m] = await Promise.all([load("user"), load("memory")]);
  const total = u.reduce((s, e) => s + e.text.length, 0) + m.reduce((s, e) => s + e.text.length, 0);
  return `${reports.join("; ")}. Всего в памяти: ${total}/${CHAR_LIMIT.user + CHAR_LIMIT.memory} симв.`;
}

/** Удалить память (очистка в настройках). */
export async function clearMemory(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.user),
    AsyncStorage.removeItem(KEYS.memory),
  ]);
}

export { CHAR_LIMIT };
