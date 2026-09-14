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
    return Array.isArray(arr) ? (arr as KanbanTask[]) : [];
  } catch {
    return [];
  }
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
