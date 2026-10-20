/**
 * MCP-клиент (Model Context Protocol) — минимальный, но настоящий.
 *
 * Раньше `aso_mcp_servers` только хранился: добавить сервер можно было,
 * а на работу агента это не влияло вообще. Здесь реальный JSON-RPC 2.0
 * поверх Streamable HTTP: initialize → tools/list → tools/call.
 *
 * Ограничение честное: stdio-серверы (npx/uvx) требуют долгоживущего
 * процесса — на телефоне их держать нечем, поэтому для них возвращаем
 * явную ошибку, а не тихий успех.
 */
import { listMcpServers, McpServer } from "./connectors";
import { isBlockedUrl, loadSecurity } from "./security";

type JsonRpcResult = { result?: any; error?: { code: number; message: string } };

async function rpc(url: string, method: string, params: unknown, sessionId?: string): Promise<{ body: any; session?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2024-11-05",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const sid = resp.headers.get("mcp-session-id") || undefined;
    const text = await resp.text();
    if (!resp.ok) return { body: { error: { code: resp.status, message: text.slice(0, 300) } }, session: sid };
    // Streamable HTTP может ответить SSE-потоком — берём последнюю data-строку
    const ctype = resp.headers.get("content-type") || "";
    let json: any = null;
    if (ctype.includes("text/event-stream")) {
      const line = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .pop();
      if (line) json = JSON.parse(line.replace(/^data:\s*/, ""));
    } else {
      json = JSON.parse(text);
    }
    return { body: (json || {}) as JsonRpcResult, session: sid };
  } finally {
    clearTimeout(timer);
  }
}

async function serverById(id: string): Promise<McpServer | null> {
  const list = await listMcpServers();
  return list.find((s) => s.id === id) ?? null;
}

/** Общий доступ к серверу: инициализация + список инструментов. */
export async function mcpTools(id: string): Promise<{ ok: boolean; message: string; tools: Array<{ name: string; description?: string }> }> {
  const s = await serverById(id);
  if (!s) return { ok: false, message: "Сервер не найден", tools: [] };
  if (!s.enabled) return { ok: false, message: `«${s.name}» выключен в коннекторах`, tools: [] };
  if (s.transport !== "http" || !s.url) {
    return {
      ok: false,
      message: `«${s.name}» использует stdio (${s.command || "npx/uvx"}). Долгоживущий процесс на телефоне не держится — подключи HTTP-сервер.`,
      tools: [],
    };
  }
  const sec = await loadSecurity();
  if (isBlockedUrl(s.url, sec.websiteBlocklist)) {
    return { ok: false, message: `Домен сервера в блок-листе: ${s.url}`, tools: [] };
  }
  try {
    const init = await rpc(s.url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aso-z", version: "1.5" },
    });
    if (init.body?.error) return { ok: false, message: `initialize: ${init.body.error.message}`, tools: [] };
    const list = await rpc(s.url, "tools/list", {}, init.session);
    if (list.body?.error) return { ok: false, message: `tools/list: ${list.body.error.message}`, tools: [] };
    const tools = (list.body?.result?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description }));
    return { ok: true, message: `${tools.length} инструм. на «${s.name}»`, tools };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e), tools: [] };
  }
}

/** Вызов инструмента MCP-сервера. */
export async function mcpCall(
  id: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; message: string; content?: string }> {
  const s = await serverById(id);
  if (!s) return { ok: false, message: "Сервер не найден" };
  if (!s.enabled) return { ok: false, message: `«${s.name}» выключен` };
  if (s.transport !== "http" || !s.url) return { ok: false, message: "Для stdio-серверов вызов недоступен на телефоне" };
  const sec = await loadSecurity();
  if (isBlockedUrl(s.url, sec.websiteBlocklist)) return { ok: false, message: "Домен в блок-листе" };
  try {
    const init = await rpc(s.url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aso-z", version: "1.5" },
    });
    if (init.body?.error) return { ok: false, message: `initialize: ${init.body.error.message}` };
    const call = await rpc(s.url, "tools/call", { name: tool, arguments: args }, init.session);
    if (call.body?.error) return { ok: false, message: `${call.body.error.message}` };
    const content = call.body?.result?.content;
    const text = Array.isArray(content)
      ? content.map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c))).join("\n")
      : JSON.stringify(call.body?.result ?? {});
    return { ok: !call.body?.result?.isError, message: tool, content: text };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}
