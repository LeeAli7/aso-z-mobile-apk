/**
 * sessions.ts — движок сессий чата (Hermes: sessions list/rename/delete/export/search).
 *
 * Сессии живут в AsyncStorage "aso_sessions" (пишет AppStore), здесь —
 * движковые операции поверх того же ключа: поиск, переименование,
 * удаление, экспорт. UI после вызова перечитывает стор.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "aso_sessions";

export interface SessionRecord {
  id: string;
  name: string;
  messages: { role: string; content: unknown }[];
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
  projectId?: string | null;
}

export async function loadSessions(): Promise<SessionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as SessionRecord[]) : [];
  } catch {
    return [];
  }
}

async function saveSessions(list: SessionRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch {}
}

/** Поиск по имени + тексту сообщений (как Hermes session_search). */
export async function searchSessions(query: string, limit = 20): Promise<SessionRecord[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const list = await loadSessions();
  const out: { s: SessionRecord; score: number }[] = [];
  for (const s of list) {
    let score = -1;
    if ((s.name || "").toLowerCase().includes(q)) score = 100;
    if (score < 0) {
      const msgs = Array.isArray(s.messages) ? s.messages : [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const c = msgs[i];
        const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
        if (text.toLowerCase().includes(q)) {
          score = 50 - Math.min(40, (msgs.length - 1 - i));
          break;
        }
      }
    }
    if (score >= 0) out.push({ s, score });
  }
  return out
    .sort((a, b) => b.score - a.score || (b.s.updatedAt ?? 0) - (a.s.updatedAt ?? 0))
    .slice(0, limit)
    .map((x) => x.s);
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  const list = await loadSessions();
  const s = list.find((x) => x.id === id);
  if (!s) return false;
  s.name = name.trim() || s.name;
  s.updatedAt = Date.now();
  await saveSessions(list);
  return true;
}

export async function deleteSession(id: string): Promise<boolean> {
  const list = await loadSessions();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  await saveSessions(next);
  return true;
}

/** Экспорт сессии в JSON-текст (для share/backup). */
export async function exportSession(id: string): Promise<string | null> {
  const list = await loadSessions();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  return JSON.stringify({ app: "aso-z", type: "session", exportedAt: new Date().toISOString(), session: s }, null, 2);
}
