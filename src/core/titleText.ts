/**
 * titleText.ts — чистые функции названий сессий (без зависимостей от RN,
 * чтобы их можно было прогонять тестом в node).
 */

/** Убирает кавычки, лишние пробелы, хвостовую точку и обрезает до 48 символов. */
export function cleanTitle(raw: string): string {
  let s = (raw || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? "";
  s = s.replace(/^["'«»“”`]+|["'«»“”`]+$/g, "").replace(/[.!…]+$/g, "").trim();
  s = s.replace(/^(название|title)\s*[:\-—]\s*/i, "");
  s = s.replace(/\s+/g, " ");
  if (s.length > 48) s = s.slice(0, 48).replace(/\s+\S*$/, "");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** Текст первых реплик, сжатый до ~1200 символов. */
export function transcriptForTitle(
  messages: { role: string; content: string; tool?: boolean }[],
): string {
  const parts: string[] = [];
  let used = 0;
  for (const m of messages) {
    if (m.tool || (m.role !== "user" && m.role !== "assistant")) continue;
    if (!m.content || m.content.startsWith("/")) continue;
    const who = m.role === "user" ? "Пользователь" : "Ассистент";
    const text = m.content.replace(/\s+/g, " ").slice(0, 400);
    parts.push(`${who}: ${text}`);
    used += text.length;
    if (parts.length >= 6 || used > 1200) break;
  }
  return parts.join("\n");
}
