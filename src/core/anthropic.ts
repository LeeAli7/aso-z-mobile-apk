/**
 * Нативный протокол Anthropic Messages (/v1/messages).
 *
 * У Anthropic нет OpenAI-совместимого эндпоинта: тело другое (system отдельным
 * полем, tools с input_schema, результаты инструментов — блоки tool_result в
 * user-сообщении), поток — не choices[].delta, а события content_block_*.
 * Поэтому для api.anthropic.com и всего, что отдаёт /v1/messages, идём своим
 * путём: переводим наш OpenAI-совместимый запрос в их формат и обратно.
 */

type Any = any;

/** Это нативный Anthropic-эндпоинт? */
export function isAnthropic(baseUrl: string): boolean {
  const u = String(baseUrl || "").toLowerCase();
  return u.includes("anthropic.com") || /\/v1\/messages\/?$/.test(u);
}

/** Полный адрес /v1/messages из любого варианта base URL. */
export function messagesUrl(baseUrl: string): string {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (/\/v1\/messages$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return clean + "/messages";
  return clean + "/v1/messages";
}

export function anthropicHeaders(apiKey?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    Accept: "text/event-stream",
  };
  if (apiKey) {
    h["x-api-key"] = apiKey;
    // некоторые прокси ждут ещё и Bearer
    h.Authorization = `Bearer ${apiKey}`;
  }
  return h;
}

function textOf(content: Any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text ?? "" : ""))
      .join("");
  }
  return "";
}

function partToAnthropic(p: Any): Any | null {
  if (!p) return null;
  if (typeof p === "string") return { type: "text", text: p };
  if (p.type === "text") return { type: "text", text: p.text ?? "" };
  if (p.type === "image_url") {
    const url = String(p.image_url?.url ?? "");
    const m = url.match(/^data:([^;]+);base64,(.*)$/);
    if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
    if (url) return { type: "image", source: { type: "url", url } };
  }
  return null;
}

function safeParse(s: Any): Any {
  if (typeof s !== "string" || !s.trim()) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Наш OpenAI-совместимый payload → тело Anthropic.
 * Ничего не теряет: system, картинки, tool_calls, tool-результаты, tools.
 */
export function toAnthropicBody(body: Any): Any {
  const msgs: Any[] = Array.isArray(body?.messages) ? body.messages : [];
  const system: string[] = [];
  const out: Any[] = [];

  for (const m of msgs) {
    if (!m) continue;
    if (m.role === "system" || m.role === "developer") {
      const t = textOf(m.content);
      if (t.trim()) system.push(t);
      continue;
    }

    if (m.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: String(m.tool_call_id ?? ""),
        content: textOf(m.content),
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b: Any) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Any[] = [];
      const txt = textOf(m.content);
      if (txt.trim()) blocks.push({ type: "text", text: txt });
      for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        const name = c?.function?.name ?? c?.name;
        if (!name) continue;
        blocks.push({
          type: "tool_use",
          id: c.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name,
          input: safeParse(c?.function?.arguments ?? c?.arguments),
        });
      }
      if (!blocks.length) blocks.push({ type: "text", text: "" });
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    const content = Array.isArray(m.content)
      ? (m.content.map(partToAnthropic).filter(Boolean) as Any[])
      : [{ type: "text", text: String(m.content ?? "") }];
    if (!content.length) content.push({ type: "text", text: "" });
    out.push({ role: "user", content });
  }

  // Anthropic требует чередования ролей: одинаковые подряд склеиваем.
  const merged: Any[] = [];
  const isToolResult = (b: Any) => b?.type === "tool_result";
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.role !== m.role) {
      merged.push({ role: m.role, content: [...m.content] });
      continue;
    }
    // Anthropic требует, чтобы tool_result шли ПЕРВЫМИ блоками сообщения.
    const firstText = prev.content.findIndex((b: Any) => !isToolResult(b));
    const trs = m.content.filter(isToolResult);
    const rest = m.content.filter((b: Any) => !isToolResult(b));
    if (firstText === -1) prev.content.push(...m.content);
    else {
      prev.content.splice(firstText, 0, ...trs);
      prev.content.push(...rest);
    }
  }

  const res: Any = {
    model: body?.model,
    max_tokens: Number(body?.max_tokens) > 0 ? Number(body.max_tokens) : 4096,
    messages: merged,
    stream: true,
  };
  if (system.length) res.system = system.join("\n\n");
  if (body?.temperature != null) res.temperature = Math.max(0, Math.min(1, Number(body.temperature)));

  if (Array.isArray(body?.tools) && body.tools.length) {
    res.tools = body.tools
      .map((t: Any) => {
        const f = t?.function ?? t;
        if (!f?.name) return null;
        return {
          name: f.name,
          description: f.description ?? "",
          input_schema: f.parameters ?? { type: "object", properties: {} },
        };
      })
      .filter(Boolean);
    if (!res.tools.length) delete res.tools;
  }

  return res;
}

export type AnthropicCall = { id: string; name: string; args: string };

export type AnthropicResult = {
  text: string;
  reasoning: string;
  calls: AnthropicCall[];
  finishReason: string | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

/**
 * Разбор SSE Anthropic: text_delta → текст, thinking_delta → размышления,
 * input_json_delta → аргументы инструмента (склеиваются по блоку).
 */
export async function readAnthropicStream(
  resp: Response,
  cb: { onToken?: (t: string) => void; onThinking?: (t: string) => void } = {},
): Promise<AnthropicResult> {
  const result: AnthropicResult = { text: "", reasoning: "", calls: [], finishReason: null };
  if (!resp.body) return result;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cur: AnthropicCall | null = null;
  let inThinking = false;
  // входные токены приходят в message_start, выходные — в message_delta
  let promptTokens = 0;

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    let ev: Any;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const type = ev?.type;

    if (type === "message_start") {
      const u = ev.message?.usage;
      if (u) {
        promptTokens =
          Number(u.input_tokens ?? 0) +
          Number(u.cache_read_input_tokens ?? 0) +
          Number(u.cache_creation_input_tokens ?? 0);
      }
      return;
    }

    if (type === "content_block_start") {
      const b = ev.content_block ?? {};
      if (b.type === "tool_use") {
        cur = { id: b.id ?? `call_${result.calls.length}`, name: b.name ?? "", args: "" };
        inThinking = false;
      } else if (b.type === "thinking") {
        inThinking = true;
      } else if (b.type === "text" && b.text) {
        result.text += b.text;
        cb.onToken?.(b.text);
        inThinking = false;
      }
      return;
    }

    if (type === "content_block_delta") {
      const d = ev.delta ?? {};
      if (d.type === "text_delta" && d.text) {
        result.text += d.text;
        cb.onToken?.(d.text);
      } else if (d.type === "thinking_delta" && d.thinking) {
        result.reasoning += d.thinking;
        cb.onThinking?.(d.thinking);
      } else if (d.type === "input_json_delta" && cur) {
        cur.args += d.partial_json ?? "";
      }
      return;
    }

    if (type === "content_block_stop") {
      if (cur) {
        result.calls.push(cur);
        cur = null;
      }
      inThinking = false;
      return;
    }

    if (type === "message_delta") {
      const sr = ev.delta?.stop_reason;
      if (sr) result.finishReason = sr === "tool_use" ? "tool_calls" : sr === "max_tokens" ? "length" : "stop";
      const u = ev.usage;
      if (u) {
        const prompt =
          promptTokens ||
          Number(u.input_tokens ?? 0) +
            Number(u.cache_read_input_tokens ?? 0) +
            Number(u.cache_creation_input_tokens ?? 0);
        const completion = Number(u.output_tokens ?? 0);
        result.usage = { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
      }
      return;
    }

    if (type === "error") {
      const msg = ev.error?.message ?? "stream error";
      throw new Error(`HTTP 200: ${msg}`);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      handle(line);
    }
  }
  if (buffer.trim()) handle(buffer.trim());

  if (cur) {
    result.calls.push(cur);
    cur = null;
  }
  if (!result.finishReason) result.finishReason = result.calls.length ? "tool_calls" : "stop";
  return result;
}
