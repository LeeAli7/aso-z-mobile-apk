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

/**
 * Сколько токенов просить под ответ, чтобы запрос целиком влез в потолок
 * провайдера (TPM = tokens per minute: вход + запрошенный ответ).
 *
 * Потолок ответа — это НЕ «сколько модель напишет», а «сколько ей разрешено».
 * Просить 8192 на модели с лимитом 8000 TPM бессмысленно: один такой запрос
 * больше всего лимита. Поэтому считаем бюджет от потолка и оставляем место
 * под инструменты, системный промпт и историю.
 */
export function planBudget(o: {
  /** Потолок провайдера в токенах в минуту (если известен). */
  tpm?: number;
  /** Схемы инструментов, токены. */
  toolsTokens: number;
  /** Системный промпт, токены. */
  sysTokens: number;
  /** История, символы (переводим в токены ~3.5 символа на токен). */
  historyChars: number;
}): { maxOut: number; historyBudget?: number } {
  // Потолок неизвестен: 8192. Меньший потолок обрезает аргументы write_file
  // на больших файлах (битый JSON → модель бросает инструмент и присылает код
  // в чат), а это хуже одного честного 413, после которого лимит уже известен.
  if (!o.tpm) return { maxOut: 8192 };

  const fixed = o.toolsTokens + o.sysTokens;
  const histTokens = Math.ceil(Math.max(0, o.historyChars) / 3.5);
  // Ответ — не больше 40 % потолка и не больше 4096.
  let maxOut = Math.min(4096, Math.max(512, Math.floor(o.tpm * 0.4)));
  // Всё вместе должно влезть с запасом ~200 токенов на разметку.
  const over = fixed + histTokens + maxOut + 200 - o.tpm;
  if (over > 0) {
    // сначала режем ответ, но не ниже 512
    const cut = Math.min(over, maxOut - 512);
    maxOut -= cut;
    const rest = over - cut;
    if (rest > 0) {
      // потом историю — до 400 токенов, ниже смысла нет
      const room = o.tpm - fixed - maxOut - 200;
      return { maxOut, historyBudget: Math.max(400, room) };
    }
  }
  return { maxOut };
}
