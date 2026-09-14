/**
 * connectors.ts — движок коннекторов (Hermes: platforms + MCP + webhooks).
 *
 * - platforms: Telegram-синхронизация (sync.ts) + статус провайдеров (providers.ts);
 * - MCP: реестр MCP-серверов (как Hermes mcp_servers в config.yaml) —
 *   add/list/test/remove; исполнение — через run_command в рантайме;
 * - webhooks: подписки на внешние события (как Hermes webhook subscribe) —
 *   add/list/test/remove; приём — через poll из UI или cron.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface McpServer {
  id: string;
  name: string;
  /** 'stdio' (command+args) | 'http' (url). */
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface WebhookSub {
  id: string;
  name: string;
  events: string;
  prompt: string;
  deliver: string;
  enabled: boolean;
  createdAt: number;
}

const MCP_KEY = "aso_mcp_servers";
const WEBHOOK_KEY = "aso_webhooks";

function genId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ── MCP ─────────────────────────────────────────────────────── */

export async function listMcpServers(): Promise<McpServer[]> {
  try {
    const raw = await AsyncStorage.getItem(MCP_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as McpServer[]) : [];
  } catch {
    return [];
  }
}

async function saveMcp(list: McpServer[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MCP_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {}
}

export async function addMcpServer(s: Omit<McpServer, "id" | "createdAt" | "enabled"> & { enabled?: boolean }): Promise<McpServer> {
  const list = await listMcpServers();
  const created: McpServer = {
    id: genId("m"),
    name: s.name.trim() || "MCP",
    transport: s.transport,
    command: s.command,
    args: s.args,
    url: s.url,
    headers: s.headers,
    enabled: s.enabled !== false,
    createdAt: Date.now(),
  };
  list.push(created);
  await saveMcp(list);
  return created;
}

export async function removeMcpServer(id: string): Promise<boolean> {
  const list = await listMcpServers();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  await saveMcp(next);
  return true;
}

export async function setMcpEnabled(id: string, enabled: boolean): Promise<boolean> {
  const list = await listMcpServers();
  const s = list.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = enabled;
  await saveMcp(list);
  return true;
}

/** Проверка MCP-сервера: stdio — бинарь в PATH; http — HEAD-запрос. */
export async function testMcpServer(id: string): Promise<{ ok: boolean; message: string }> {
  const list = await listMcpServers();
  const s = list.find((x) => x.id === id);
  if (!s) return { ok: false, message: "Сервер не найден" };
  try {
    if (s.transport === "http") {
      if (!s.url) return { ok: false, message: "Нет URL" };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const resp = await fetch(s.url, { method: "HEAD", signal: ctrl.signal });
        return { ok: resp.ok, message: resp.ok ? `HTTP ${resp.status}` : `HTTP ${resp.status}` };
      } finally {
        clearTimeout(timer);
      }
    }
    // stdio: проверяем наличие команды в рантайме
    const { runCommandCapture, runtimeAvailable } = await import("./runtime");
    if (!runtimeAvailable()) return { ok: false, message: "Рантайм доступен только на Android" };
    const bin = (s.command || "").trim().split(/\s+/)[0];
    if (!bin) return { ok: false, message: "Нет команды" };
    const r = await runCommandCapture(`command -v ${bin}`);
    return r.ok && r.output?.trim()
      ? { ok: true, message: r.output.trim() }
      : { ok: false, message: `«${bin}» не найден в PATH` };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}

/* ── Webhooks ────────────────────────────────────────────────── */

export async function listWebhooks(): Promise<WebhookSub[]> {
  try {
    const raw = await AsyncStorage.getItem(WEBHOOK_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as WebhookSub[]) : [];
  } catch {
    return [];
  }
}

async function saveWebhooks(list: WebhookSub[]): Promise<void> {
  try {
    await AsyncStorage.setItem(WEBHOOK_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {}
}

export async function addWebhook(w: Omit<WebhookSub, "id" | "createdAt" | "enabled"> & { enabled?: boolean }): Promise<WebhookSub> {
  const list = await listWebhooks();
  const created: WebhookSub = {
    id: genId("w"),
    name: w.name.trim() || "Webhook",
    events: w.events.trim(),
    prompt: w.prompt.trim(),
    deliver: w.deliver.trim() || "chat",
    enabled: w.enabled !== false,
    createdAt: Date.now(),
  };
  list.push(created);
  await saveWebhooks(list);
  return created;
}

export async function removeWebhook(id: string): Promise<boolean> {
  const list = await listWebhooks();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  await saveWebhooks(next);
  return true;
}

export async function setWebhookEnabled(id: string, enabled: boolean): Promise<boolean> {
  const list = await listWebhooks();
  const w = list.find((x) => x.id === id);
  if (!w) return false;
  w.enabled = enabled;
  await saveWebhooks(list);
  return true;
}

/** Статус платформ для UI Коннекторов: Telegram-синхронизация + провайдеры. */
export async function platformsStatus(): Promise<{ telegram: { linked: boolean }; providers: { total: number; custom: number } }> {
  try {
    const SecureStore = await import("expo-secure-store");
    let linked = false;
    try {
      const tok = await SecureStore.getItemAsync("aso_token").catch(() => null);
      linked = !!tok;
    } catch {}
    const { listCustomProviders } = await import("./providers");
    const customs = await listCustomProviders().catch(() => []);
    return {
      telegram: { linked },
      providers: { total: customs.length, custom: customs.length },
    };
  } catch {
    return { telegram: { linked: false }, providers: { total: 0, custom: 0 } };
  }
}
