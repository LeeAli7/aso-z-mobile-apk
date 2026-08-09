/**
 * web_search.ts — поиск в интернете для агента.
 *
 * Без API-ключей: используем DuckDuckGo HTML (lite) — возвращает до N
 * результатов. На Android идёт напрямую (fetch к duckduckgo.com), на web —
 * CORS блокирует, поэтому через наш dev-gw (только для отладки UI).
 */
import { Platform } from "react-native";
import { config } from "./env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const MAX_RESULTS = 5;

/** Поиск через DuckDuckGo lite (html.duckduckgo.com/html/?q=...). */
export async function webSearch(query: string): Promise<{ ok: boolean; results: SearchResult[]; error?: string }> {
  const q = query.trim();
  if (!q) return { ok: false, results: [], error: "пустой запрос" };

  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=ru-ru`;
  let url = target;
  if (Platform.OS === "web") {
    url = `${config.apiBase}/api/mobile/gw?url=${encodeURIComponent(target)}`;
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!resp.ok) return { ok: false, results: [], error: `HTTP ${resp.status}` };
    const html = await resp.text();

    // Парсим result__a (ссылка) + result__snippet (описание) — структура lite-версии.
    // Блоки результата обёрнуты в <div class="result results_links ...
    const results: SearchResult[] = [];
    const re = /<div class="result__body[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < MAX_RESULTS) {
      const block = m[1];
      const a = block.match(/<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
      const sn = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
      if (!a) continue;
      const url2 = decodeURIComponent(a[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ""));
      const cleanUrl = url2.startsWith("http") ? url2 : "https://" + url2.trim();
      results.push({
        title: stripHtml(a[2]).slice(0, 200),
        url: cleanUrl.slice(0, 500),
        snippet: stripHtml(sn ? sn[1] : "").slice(0, 400),
      });
    }

    // fallback: если regex не сработал (разметка изменилась) — вытащим все ссылки подряд
    if (results.length === 0) {
      const loose = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
      let lm: RegExpExecArray | null;
      while ((lm = loose.exec(html)) && results.length < MAX_RESULTS) {
        const url2 = decodeURIComponent(lm[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ""));
        results.push({
          title: stripHtml(lm[2]).slice(0, 200),
          url: url2.startsWith("http") ? url2 : "https://" + url2.trim(),
          snippet: "",
        });
      }
    }

    if (results.length === 0) {
      return { ok: false, results: [], error: "поиск не вернул результатов" };
    }
    return { ok: true, results };
  } catch (e: any) {
    return { ok: false, results: [], error: String(e?.message || e) };
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Отформатировать результаты для модели. */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "Ничего не найдено.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`.trim())
    .join("\n\n");
}