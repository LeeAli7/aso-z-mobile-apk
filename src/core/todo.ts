/**
 * todo.ts — планировщик задач агента (как Hermes todo tool).
 *
 * In-memory список задач + персист в AsyncStorage. Агент может:
 *  - создать задачу (content + приоритет),
 *  - отметить выполненной,
 *  - отменить,
 *  - показать весь список.
 * UI (Настройки → Агент → Задачи) показывает то же самое состояние.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
}

const KEY = "aso_todo";

const MAX_ITEMS = 128;
const MAX_CONTENT = 4000;

function genId(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function loadTodos(): Promise<TodoItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as TodoItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function save(items: TodoItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // не критично
  }
}

export interface TodoOp {
  action: "add" | "update" | "remove" | "list";
  content?: string;
  id?: string;
  status?: TodoStatus;
}

/** Выполнить операцию над todo (тул агента). Возвращает строку-отчёт. */
export async function runTodoOps(ops: TodoOp[]): Promise<string> {
  if (!Array.isArray(ops) || ops.length === 0) {
    return "ошибка: не передано ни одной операции. Формат: [{\"action\":\"add|update|remove|list\",\"content\":\"...\",\"id\":\"...\",\"status\":\"pending|in_progress|completed|cancelled\"}]";
  }
  let items = await loadTodos();
  const reports: string[] = [];

  for (const op of ops) {
    switch (op.action) {
      case "add": {
        if (!op.content?.trim()) {
          reports.push("add: нет content");
          continue;
        }
        if (items.length >= MAX_ITEMS) {
          reports.push("add: лимит задач достигнут");
          continue;
        }
        items.push({
          id: genId(),
          content: op.content.trim().slice(0, MAX_CONTENT),
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        reports.push("add: добавлена задача");
        break;
      }
      case "update": {
        const it = items.find((x) => x.id === op.id);
        if (!it) {
          reports.push(`update: задача ${op.id ?? "?"} не найдена`);
          continue;
        }
        if (op.status) it.status = op.status;
        if (op.content?.trim()) it.content = op.content.trim().slice(0, MAX_CONTENT);
        it.updatedAt = Date.now();
        reports.push(`update: задача ${op.id} → ${it.status}`);
        break;
      }
      case "remove": {
        const before = items.length;
        items = items.filter((x) => x.id !== op.id);
        reports.push(`remove: удалено ${before - items.length} шт.`);
        break;
      }
      case "list":
        // сам отчёт соберём в конце
        break;
      default:
        reports.push(`неизвестное действие: ${String(op.action)}`);
    }
  }

  await save(items);

  const lines = items
    .map((x, i) => `${i + 1}. [${x.status === "completed" ? "x" : " "}] (${x.status}) ${x.content.slice(0, 120)}`)
    .join("\n");
  const listPart = lines ? `\nТекущие задачи:\n${lines}` : "\nЗадач нет.";
  return (reports.join("; ") || "ok") + listPart;
}

/** Очистить всё (UI). */
export async function clearTodos(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}