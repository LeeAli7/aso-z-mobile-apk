/**
 * stall.ts — «запрос повис».
 *
 * Провайдер может не ответить и не выдать ошибку: соединение умерло в фоне,
 * ОС прибила сокет, шлюз молчит. Снаружи это выглядит как «отправил и ничего»:
 * ни ответа, ни ошибки, ни кнопки повтора. Определяем такую тишину и рвём
 * запрос, чтобы пользователь увидел причину и мог повторить.
 *
 * Пока инструмент реально работает (долгая команда), тишина нормальна —
 * такой случай не считаем зависанием.
 */

export interface StallInput {
  now: number;
  lastBeat: number;      // когда последний раз было хоть какое-то событие
  toolBusy: boolean;     // инструмент выполняется прямо сейчас
  limitMs: number;
}

export function isStalled({ now, lastBeat, toolBusy, limitMs }: StallInput): boolean {
  if (toolBusy) return false;
  if (!Number.isFinite(lastBeat) || lastBeat <= 0) return false;
  return now - lastBeat >= limitMs;
}

/** Порог тишины: до первого токена провайдер думает дольше, дальше — меньше. */
export const STALL_FIRST_MS = 45_000;
export const STALL_RESUME_MS = 8_000;
