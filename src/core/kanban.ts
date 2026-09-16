/**
 * kanban.ts — доска задач агента (как Hermes kanban, упрощённо).
 *
 * Hermes держит доску в SQLite для мульти-агентов; на телефоне —
 * AsyncStorage: задачи create/assign/status/comment/block/archive.
 * UI (Kanban-экран) читает через listTasks.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type KanbanStatus = "todo" | "doing" | "done" | "blocked" | "archived";

export interface KanbanTask {
  id: string;
  title: string;
  desc?: string;
  status: KanbanStatus;
  assignee?: string | null;
  comments: { text: string; createdAt: number }[];
  createdAt: number;
  updatedAt: number;
}

const KEY = "aso_kanban_tasks";

function genId(): string {
  return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listTasks(): Promise<KanbanTask[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Фаза 1: нормализация UI-формата {id,title,assignee,col} → движковый KanbanTask.
    // Один ключ aso_kanban_tasks, два писателя — читаем оба, сохраняем движковый.
    return (arr as Array<Record<string, unknown>>).map((x) => normalizeTask(x)).filter((t): t is KanbanTask => !!t);
  } catch {
    return [];
  }
}

/** UI-формат KanbanScreen: { id, title, assignee: string, col: todo|doing|done }. */
export interface UiKanbanTask {
  id: string;
  title: string;
  assignee: string;
  col: "todo" | "doing" | "done";
}

function normalizeTask(x: Record<string, unknown>): KanbanTask | null {
  if (!x || typeof x !== "object") return null;
  const id = String((x as { id?: unknown }).id ?? "");
  const title = String((x as { title?: unknown }).title ?? "").trim() || "Без названия";
  if (!id) return null;
  // Движковый формат уже: status + comments
  if (typeof (x as { status?: unknown }).status === "string" && Array.isArray((x as { comments?: unknown }).comments)) {
    const t = x as unknown as KanbanTask;
    return { ...t, id, title };
  }
  // UI-формат: col → status, assignee строка → assignee|null
  const col = (x as { col?: unknown }).col;
  const status: KanbanStatus = col === "doing" || col === "done" ? (col as KanbanStatus) : "todo";
  const assigneeRaw = (x as { assignee?: unknown }).assignee;
  const now = Date.now();
  return {
    id,
    title,
    status,
    assignee: typeof assigneeRaw === "string" && assigneeRaw.trim() ? assigneeRaw.trim() : null,
    comments: [],
    createdAt: typeof (x as { createdAt?: unknown }).createdAt === "number" ? (x as { createdAt: number }).createdAt : now,
    updatedAt: now,
  };
}

/** Движковые задачи → UI-формат KanbanScreen (для обратной совместимости чтения). */
export function toUiTasks(tasks: KanbanTask[]): UiKanbanTask[] {
  return tasks
    .filter((t) => t.status === "todo" || t.status === "doing" || t.status === "done")
    .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee ?? "", col: t.status as "todo" | "doing" | "done" }));
}

async function save(tasks: KanbanTask[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(tasks.slice(0, 500)));
  } catch {}
}

export async function createTask(title: string, desc?: string): Promise<KanbanTask> {
  const tasks = await listTasks();
  const t: KanbanTask = {
    id: genId(),
    title: title.trim() || "Без названия",
    desc: desc?.trim() || undefined,
    status: "todo",
    assignee: null,
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(t);
  await save(tasks);
  return t;
}

export async function getTask(id: string): Promise<KanbanTask | null> {
  const tasks = await listTasks();
  return tasks.find((t) => t.id === id) ?? null;
}

export async function assignTask(id: string, assignee: string | null): Promise<boolean> {
  const tasks = await listTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return false;
  t.assignee = assignee?.trim() || null;
  t.updatedAt = Date.now();
  await save(tasks);
  return true;
}

export async function setTaskStatus(id: string, status: KanbanStatus): Promise<boolean> {
  const tasks = await listTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return false;
  t.status = status;
  t.updatedAt = Date.now();
  await save(tasks);
  return true;
}

/** complete / block / unblock — алиасы статуса (как Hermes verbs). */
export async function completeTask(id: string): Promise<boolean> {
  return setTaskStatus(id, "done");
}

export async function blockTask(id: string, reason?: string): Promise<boolean> {
  const ok = await setTaskStatus(id, "blocked");
  if (ok && reason?.trim()) await commentTask(id, `Блокер: ${reason.trim()}`);
  return ok;
}

export async function unblockTask(id: string): Promise<boolean> {
  const tasks = await listTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t || t.status !== "blocked") return false;
  return setTaskStatus(id, "todo");
}

export async function archiveTask(id: string): Promise<boolean> {
  return setTaskStatus(id, "archived");
}

export async function commentTask(id: string, text: string): Promise<boolean> {
  const tasks = await listTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t || !text.trim()) return false;
  t.comments.push({ text: text.trim().slice(0, 2000), createdAt: Date.now() });
  t.updatedAt = Date.now();
  await save(tasks);
  return true;
}

export async function deleteTask(id: string): Promise<boolean> {
  const tasks = await listTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return false;
  await save(next);
  return true;
}

/** Счётчики по статусам для UI-бейджей. */
export async function taskStats(): Promise<Record<KanbanStatus, number>> {
  const tasks = await listTasks();
  const stats: Record<KanbanStatus, number> = { todo: 0, doing: 0, done: 0, blocked: 0, archived: 0 };
  for (const t of tasks) stats[t.status] = (stats[t.status] ?? 0) + 1;
  return stats;
}
