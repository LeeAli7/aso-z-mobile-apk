/**
 * Локальный Vibe-слой.
 *
 * ВСЁ хранится на устройстве:
 *  - список проектов и история чата — AsyncStorage
 *  - файлы проекта — documentDirectory/vibe/<projectId>/
 * Никакого нашего сервера. Агент-чат идёт через прямой канал (gateway.ts),
 * файлы агент «пишет» блоками [FILE:path] ```…``` — приложение сохраняет
 * их в хранилище устройства.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { streamChat, ModelInfo, ChatMessage } from "./gateway";

/* ── Types ─────────────────────────────────────────────── */

export interface VibeProject {
  id: string;
  name: string;
  desc: string;
  createdAt: number;
  updatedAt: number;
}

export interface VibeMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool?: string;
  result?: string;
  streaming?: boolean;
}

export interface VibeFileEntry {
  name: string; // относительный путь в проекте
  size: number;
}

const PROJECTS_KEY = "vibe:projects";
const MSGS_PREFIX = "vibe:msgs:";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Корневая папка vibe: documentDirectory/vibe */
function vibeRoot(): Directory {
  return new Directory(Paths.document, "vibe");
}

/** Папка конкретного проекта */
function projectDir(id: string): Directory {
  return new Directory(vibeRoot(), id);
}

async function ensureProjectDir(id: string): Promise<Directory> {
  const root = vibeRoot();
  if (!root.exists) root.create({ idempotent: true, intermediates: true });
  const dir = projectDir(id);
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/* ── Projects ──────────────────────────────────────────── */

export async function listProjects(): Promise<VibeProject[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as VibeProject[];
  } catch {
    return [];
  }
}

async function saveProjects(list: VibeProject[]): Promise<void> {
  await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
}

export async function createProject(name: string, desc: string): Promise<VibeProject> {
  const list = await listProjects();
  const p: VibeProject = {
    id: genId(),
    name: name.trim() || "Новый проект",
    desc: desc.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await ensureProjectDir(p.id);
  list.unshift(p);
  await saveProjects(list);
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  const list = await listProjects();
  await saveProjects(list.filter((p) => p.id !== id));
  const dir = projectDir(id);
  if (dir.exists) dir.delete();
  await AsyncStorage.removeItem(MSGS_PREFIX + id);
}

/** Переименование проекта (файлы и чат не трогаем — только метаданные). */
export async function renameProject(id: string, newName: string): Promise<void> {
  const list = await listProjects();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error("Project not found");
  p.name = newName.trim() || p.name;
  p.updatedAt = Date.now();
  await saveProjects(list);
}

/* ── Files ─────────────────────────────────────────────── */

export async function listFiles(projectId: string): Promise<VibeFileEntry[]> {
  const dir = projectDir(projectId);
  if (!dir.exists) return [];
  const out: VibeFileEntry[] = [];
  const walk = (d: Directory, prefix: string) => {
    for (const item of d.list()) {
      if (item instanceof File) {
        out.push({ name: prefix + item.name, size: item.size ?? 0 });
      } else if (item instanceof Directory) {
        walk(item, prefix + item.name + "/");
      }
    }
  };
  try {
    walk(dir, "");
  } catch {}
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Пишет файл в проект, создавая промежуточные папки. */
export async function writeFile(projectId: string, relPath: string, content: string): Promise<void> {
  const dir = await ensureProjectDir(projectId);
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let cur = dir;
  for (const seg of parts) {
    const next = new Directory(cur, seg);
    if (!next.exists) next.create({ idempotent: true, intermediates: true });
    cur = next;
  }
  const f = new File(cur, fileName);
  if (!f.exists) f.create({ intermediates: true });
  await f.write(content);
}

export async function readFile(projectId: string, relPath: string): Promise<string> {
  const dir = projectDir(projectId);
  const f = new File(dir, ...relPath.split("/").filter(Boolean));
  if (!f.exists) throw new Error("File not found: " + relPath);
  return await f.text();
}

export async function deleteFile(projectId: string, relPath: string): Promise<void> {
  const dir = projectDir(projectId);
  const f = new File(dir, ...relPath.split("/").filter(Boolean));
  if (f.exists) f.delete();
}

/* ── Chat history ──────────────────────────────────────── */

export async function loadMessages(projectId: string): Promise<VibeMsg[]> {
  try {
    const raw = await AsyncStorage.getItem(MSGS_PREFIX + projectId);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as VibeMsg[]) : [];
  } catch {
    return [];
  }
}

export async function saveMessages(projectId: string, msgs: VibeMsg[]): Promise<void> {
  const clean = msgs.map((m) => ({ ...m, streaming: false }));
  await AsyncStorage.setItem(MSGS_PREFIX + projectId, JSON.stringify(clean));
}

/* ── Agent chat (direct channel + FILE blocks) ─────────── */

const SYSTEM_PROMPT = `Ты — агент-кодер в локальном проекте пользователя.
Когда нужно создать или изменить файл, выводи блок(и) в ТОЧНО таком формате:

[FILE: путь/имя.файла]
\`\`\`язык
содержимое файла
\`\`\`

Можно выводить несколько блоков подряд. После блоков дай краткое резюме (2-4 предложения) на языке пользователя. Если файлы не нужны — просто ответь.`;

export interface VibeChatCallbacks {
  onToken: (text: string) => void;
  onTool: (label: string) => void;
  onDone: (cleanText: string, writtenFiles: string[]) => void;
  onError: (message: string) => void;
}

/** Извлекает [FILE:path] блоки из текста ответа. */
export function parseFileBlocks(text: string): { path: string; content: string }[] {
  const re = /\[FILE:\s*([^\n\]]+)\]\s*```[^\n]*\n([\s\S]*?)```/g;
  const out: { path: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ path: m[1].trim(), content: m[2] });
  }
  return out;
}

/**
 * Агент-чат: шлёт историю напрямую провайдеру (gateway), собирает ответ,
 * парсит [FILE:…] блоки и пишет файлы в хранилище устройства.
 */
export async function vibeChat(
  model: ModelInfo,
  projectId: string,
  history: VibeMsg[],
  callbacks: VibeChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      // tool/result — служебные сообщения UI, провайдеру не отправляем
      .filter((m) => !m.streaming && !m.tool && !m.result && m.content.trim())
      .map((m): ChatMessage => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
  ];

  let acc = "";
  let written: string[] = [];

  await streamChat(model, messages, {
    onToken: (tok) => {
      acc += tok;
      callbacks.onToken(tok);
      // tool-событие: как только видим начало [FILE: — показываем «пишу файл»
      const fm = acc.match(/\[FILE:\s*([^\n\]]+)\]/);
      if (fm && !written.includes("__showed_" + fm[1])) {
        written.push("__showed_" + fm[1]);
        callbacks.onTool("пишу " + fm[1].trim());
      }
    },
    onDone: async (clean) => {
      const body = clean || acc;
      const blocks = parseFileBlocks(body);
      const names: string[] = [];
      for (const b of blocks) {
        try {
          await writeFile(projectId, b.path, b.content);
          names.push(b.path);
        } catch (e: any) {
          callbacks.onError(`не удалось записать ${b.path}: ${e?.message || e}`);
          return;
        }
      }
      // чистый текст без FILE-блоков
      const cleanText = body.replace(/\[FILE:[^\]]+\]\s*```[^\n]*\n[\s\S]*?```/g, "").trim() || acc;
      callbacks.onDone(cleanText, names);
    },
    onError: (err) => callbacks.onError(err),
  }, signal);
}
