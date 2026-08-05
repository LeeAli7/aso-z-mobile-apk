/**
 * Прямой канал к провайдерам (opencode / kilo).
 *
 * Приложение бьёт НАПРЯМУЮ в upstream — мимо нашего сервера вообще.
 * URL разшифровываются в рантайме через src/core/crypto.ts.
 * Модели описаны в src/config/encrypted.ts (без открытых имён).
 */
import { ENCRYPTED_PROVIDERS } from "../config/encrypted";
import { decrypt } from "./crypto";
import { Platform } from "react-native";
import { config } from "./env";

export interface ModelInfo {
  /** API model name (передаётся в body) */
  modelName: string;
  /** Отображаемое имя (Aso / Aso Math ...) */
  displayName: string;
  tier: string;
  premium: boolean;
  caps: string[];
  /** Расшифрованный base URL провайдера */
  baseUrl: string;
  /** Индекс провайдера в конфиге */
  providerIdx: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onDone: (cleanText: string) => void;
  onError: (message: string) => void;
}

/** Разворачивает зашифрованный конфиг в список моделей. */
export function loadModels(): ModelInfo[] {
  const out: ModelInfo[] = [];
  ENCRYPTED_PROVIDERS.forEach((prov, idx) => {
    const baseUrl = decrypt(prov.e as unknown as string);
    (prov.m as unknown as Array<Record<string, unknown>>).forEach((m) => {
      out.push({
        modelName: String(m.n),
        displayName: String(m.d),
        tier: String(m.tier),
        premium: Boolean(m.prem),
        caps: Array.isArray(m.caps) ? (m.caps as string[]) : [],
        baseUrl,
        providerIdx: idx,
      });
    });
  });
  return out;
}

/**
 * Стриминг chat completion напрямую к провайдеру.
 * Использует fetch + ReadableStream (RN 0.7x/0.8x поддерживает).
 */
export async function streamChat(
  model: ModelInfo,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<void> {
  // Нативные платформы: прямой запрос к провайдеру (никакого сервера в цепочке).
  // Web (dev-проверка): fetch к провайдеру блокируется CORS, поэтому идём через
  // dev-прокси нашего backend — ТОЛЬКО для браузерной отладки UI, не для продакшена.
  let endpoint = model.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  if (Platform.OS === "web") {
    endpoint = `${config.apiBase}/api/mobile/gw?url=${encodeURIComponent(endpoint)}`;
  }
  const payload = {
    model: model.modelName,
    messages,
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
  };

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const t = await resp.text();
        detail = `${detail}: ${t.slice(0, 300)}`;
      } catch {}
      callbacks.onError(detail);
      return;
    }

    if (resp.body == null) {
      callbacks.onError("empty response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let thinking = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Парсим SSE-строки "data: {...}"
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data:")) line = line.slice(5).trim();
        if (line === "[DONE]") {
          const clean = thinking && !full ? extractFromThinking(thinking) : full;
          callbacks.onDone(clean || full || "");
          return;
        }
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const delta = obj?.choices?.[0]?.delta;
          const content = delta?.content || "";
          const reasoning =
            delta?.reasoning_content || delta?.reasoning || "";
          if (content) {
            full += content;
            callbacks.onToken(content);
          } else if (reasoning) {
            thinking += reasoning;
          }
        } catch {
          // пропускаем не-JSON (keepalive и т.п.)
        }
      }
    }
    // добиваем хвост
    if (buffer.trim()) {
      const line = buffer.trim();
      try {
        const obj = JSON.parse(line.replace(/^data:\s*/, ""));
        const delta = obj?.choices?.[0]?.delta;
        const content = delta?.content || "";
        if (content) {
          full += content;
          callbacks.onToken(content);
        } else {
          const reasoning = delta?.reasoning_content || delta?.reasoning || "";
          if (reasoning) thinking += reasoning;
        }
      } catch {}
    }
    const finalClean = thinking && !full ? extractFromThinking(thinking) : full;
    callbacks.onDone(finalClean || full || "");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    callbacks.onError(msg);
  }
}

/** Пытается вытащить ответ из reasoning-only вывода (как _extract_answer_from_thinking). */
function extractFromThinking(thinking: string): string {
  // ищем маркеры ответа в последних 50% текста
  const half = thinking.slice(Math.floor(thinking.length / 2));
  const markers = [
    /(?:^|\n)\s*\*?\*?(?:Ответ|Answer|Таким образом|So,? the answer|The answer)\*?\*?\s*:?\s*(.+)/i,
    /(?:^|\n)\s*\*?\{[^}]*\}\*?\s*(.+)/,
  ];
  for (const re of markers) {
    const m = half.match(re);
    if (m && m[1] && m[1].trim()) {
      return m[1].trim().replace(/^["']|["']$/g, "").slice(0, 4000);
    }
  }
  // последний абзац как ответ
  const paras = thinking.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.length ? paras[paras.length - 1].slice(0, 4000) : thinking.slice(0, 4000);
}