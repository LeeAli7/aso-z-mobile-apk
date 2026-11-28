/**
 * Решение «что делать с отклонённым запросом» — чистая функция (I-16).
 *
 * Вынесено из цикла намеренно: раньше ветка «лимит токенов в минуту» делала
 * безусловный `continue`, и если история уже не ужималась (системный промпт +
 * схемы инструментов сами больше потолка), приложение молотило один и тот же
 * запрос бесконечно — за ночь выело дневную квоту Groq (3703 попытки).
 * Теперь у каждой ветки есть выход.
 */

export type RetryPlan =
  | { action: "retry-now"; shrinkTo?: number }
  | { action: "retry-wait"; waitMs: number }
  | { action: "fail"; error: string };

export function planRetry(o: {
  /** Номер попытки, с нуля. */
  attempt: number;
  kind: string;
  retryable: boolean;
  maxAttempts: number;
  /** Провайдер назвал потолок токенов в минуту. */
  limitTokens?: number;
  /** Сколько раз уже пытались лечить этот лимит в этом запросе. */
  tpmTries: number;
  /** Ужатие истории реально что-то уменьшило. */
  shrinkReduced: boolean;
  /** Пауза, посчитанная по типу ошибки. */
  waitMs?: number;
  /** Сырой текст ошибки — уходит как есть, если повторять нечего. */
  raw: string;
}): RetryPlan {
  // Абсолютный предохранитель: больше 12 запросов на один вызов не делаем.
  if (o.attempt >= 12) return { action: "fail", error: o.raw };

  if (o.limitTokens) {
    // Первый раз узнали потолок — следующая попытка пойдёт уже с уменьшенным
    // max_tokens (именно он и раздувал запрос до 9035 при лимите 8000), поэтому
    // один повтор делаем всегда. Дальше — только если сжатие реально помогло.
    const learnedNow = o.tpmTries === 0;
    if (o.tpmTries >= 2 || (!learnedNow && !o.shrinkReduced)) {
      return {
        action: "fail",
        error:
          `Модель не тянет запрос: системный промпт и инструменты вместе больше её лимита ` +
          `${o.limitTokens} токенов в минуту, и сжать историю уже нечем. ` +
          `Выбери модель с бо́льшим лимитом (TPM) — на этой задача не поедет.`,
      };
    }
    return { action: "retry-now", shrinkTo: o.limitTokens };
  }

  if (o.retryable && o.attempt < o.maxAttempts) {
    return { action: "retry-wait", waitMs: Math.max(0, o.waitMs ?? 0) };
  }

  return { action: "fail", error: o.raw };
}
