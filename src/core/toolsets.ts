/**
 * toolsets.ts — реестр тулсетов (как Hermes TOOLSETS в toolsets.py).
 *
 * Каждый тулсет = именованная группа тулов из tools.ts. UI показывает
 * список с вкл/выкл; gateway отдаёт модели только тулы включённых сетов.
 * Изменения применяются с нового агентского хода (как Hermes /reset).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { toolNames } from "./tools";

export interface ToolsetDef {
  name: string;
  description: string;
  tools: string[];
  defaultOn: boolean;
}

const KEY = "aso_toolsets_overrides"; // Record<name, boolean> — явные вкл/выкл юзера

/** Тулы, известные в реестре tools.ts. Неизвестные имена фильтруются. */
const T = (...names: string[]) => names;

export const TOOLSETS: ToolsetDef[] = [
  { name: "terminal", description: "Терминал: выполнение команд", tools: T("run_command"), defaultOn: true },
  { name: "file", description: "Файлы: чтение/запись/список", tools: T("list_files", "read_file", "write_file"), defaultOn: true },
  { name: "memory", description: "Память агента", tools: T("memory", "memory_snapshot"), defaultOn: true },
  { name: "todo", description: "Задачи агента", tools: T("todo"), defaultOn: true },
  { name: "skills", description: "Навыки: просмотр/управление", tools: T("skill_view", "skill_manage"), defaultOn: true },
  { name: "web", description: "Веб-поиск", tools: T("web_search"), defaultOn: true },
  { name: "delegation", description: "Субагенты", tools: T("delegate_task"), defaultOn: true },
  { name: "session_search", description: "Поиск по прошлым диалогам", tools: T("session_search"), defaultOn: false },
];

async function loadOverrides(): Promise<Record<string, boolean>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const obj = JSON.parse(raw ?? "{}");
    return obj && typeof obj === "object" ? (obj as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Включён ли тулсет (по умолчанию — defaultOn, если юзер не менял). */
export async function isToolsetEnabled(name: string): Promise<boolean> {
  const def = TOOLSETS.find((t) => t.name === name);
  if (!def) return false;
  const overrides = await loadOverrides();
  if (name in overrides) return !!overrides[name];
  return def.defaultOn;
}

export async function setToolsetEnabled(name: string, enabled: boolean): Promise<void> {
  const overrides = await loadOverrides();
  overrides[name] = enabled;
  await AsyncStorage.setItem(KEY, JSON.stringify(overrides)).catch(() => {});
}

/** Состояние всех тулсетов для UI. */
export async function listToolsets(): Promise<{ name: string; description: string; enabled: boolean; tools: string[] }[]> {
  const overrides = await loadOverrides();
  return TOOLSETS.map((t) => ({
    name: t.name,
    description: t.description,
    tools: t.tools,
    enabled: t.name in overrides ? !!overrides[t.name] : t.defaultOn,
  }));
}

/** Тулы включённых сетов (пересечение с реально зарегистрированными). */
export async function enabledTools(): Promise<string[]> {
  const states = await listToolsets();
  const known = new Set(toolNames());
  const out: string[] = [];
  for (const s of states) {
    if (!s.enabled) continue;
    for (const tool of s.tools) {
      if (known.has(tool) && !out.includes(tool)) out.push(tool);
    }
  }
  return out;
}
