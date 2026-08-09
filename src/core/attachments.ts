/**
 * attachments.ts — превращение прикреплённых файлов в части запроса модели.
 *
 * Фото: читается в base64 и уходит как image_url (data URL) — OpenAI vision формат.
 * Текстовые файлы: содержимое встраивается в текст сообщения (имя + начало контента),
 * чтобы модель видела файл, даже если провайдер не поддерживает vision.
 *
 * Используется и при первой отправке (attachment), и при переформировании истории
 * (сохранённые в Msg поля image / file).
 */
import { File } from "expo-file-system";
import type { ChatPart } from "./gateway";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "py", "rb", "go",
  "rs", "java", "kt", "c", "h", "cpp", "hpp", "css", "html", "xml", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "sh", "bash", "zsh", "sql", "log", "csv", "tsv",
  "env", "gitignore", "dockerfile", "lock",
]);

export function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXT.has(ext)) return true;
  if (/^(dockerfile|makefile|procfile)$/i.test(name)) return true;
  return false;
}

async function exists(uri: string): Promise<boolean> {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Собирает части сообщения из вложения.
 * kind "image" — photo data URL; kind "file" — текст файла (или заглушка для бинарного).
 */
export async function buildAttachmentParts(
  kind: "image" | "file",
  uri: string,
  name?: string,
): Promise<ChatPart[]> {
  try {
    if (!(await exists(uri))) return [];
    const f = new File(uri);

    if (kind === "image") {
      const b64 = await f.base64();
      const ext = name?.split(".").pop()?.toLowerCase() || "jpeg";
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return [{ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }];
    }

    // файл: по возможности встраиваем текст
    if (name && isTextFile(name)) {
      const text = await f.text();
      return [{
        type: "text",
        text: `\n\n[Прикреплённый файл: ${name}]\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\``,
      }];
    }
    return [{
      type: "text",
      text: `\n[Прикреплённый файл: ${name ?? "файл"} (бинарный — содержимое встроить не могу, но он был приложен пользователем)]`,
    }];
  } catch {
    return [];
  }
}