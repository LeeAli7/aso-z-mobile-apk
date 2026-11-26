/**
 * sessionTitle.ts — автоназвание чата по первым сообщениям.
 *
 * Механика: как только в сессии набралось 2–3 реплики пользователя и ход
 * завершён, модель один раз получает короткую выжимку и возвращает название
 * в 2–5 слов. Дальше сессия помечается как названная автоматически — повторно
 * токены не тратятся, а ручное переименование отключает механику навсегда.
 */
import type { ChatMessage, ModelInfo } from "./gateway";
import { streamChat } from "./gateway";
import { cleanTitle, transcriptForTitle } from "./titleText";

const SYSTEM = `Ты придумываешь название для чата. По репликам пользователя и ответам ассистента дай ОДНО название: 2–5 слов, по сути темы, без кавычек, без точки в конце, без эмодзи и без слов «чат», «диалог», «обсуждение». Пиши на языке разговора. Отвечай ТОЛЬКО названием.`;

export async function suggestSessionTitle(
  model: ModelInfo,
  messages: { role: string; content: string; tool?: boolean }[],
  signal?: AbortSignal,
): Promise<string | null> {
  const transcript = transcriptForTitle(messages);
  if (!transcript) return null;
  let acc = "";
  try {
    await streamChat(
      model,
      [
        { role: "system", content: SYSTEM } as ChatMessage,
        { role: "user", content: transcript } as ChatMessage,
      ],
      {
        onToken: (t: string) => { acc += t; },
        onThinking: () => {},
        onDone: () => {},
        onError: () => {},
      },
      signal,
      { maxTokens: 32 },
    );
  } catch {
    return null;
  }
  const title = cleanTitle(acc);
  return title.length >= 2 ? title : null;
}
