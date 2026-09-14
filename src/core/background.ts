/**
 * background.ts — единый реестр фоновых процессов (один источник правды).
 *
 * Шторка фоновых процессов (UI) читает ТОЛЬКО отсюда:
 *  - рантайм-сессии (долгие команды через runCommand, sessionId >= 0),
 *  - пакеты делегации (субагенты runDelegation — пока идёт Promise.all),
 *  - включённые cron-задачи (планировщик тикает, пока приложение открыто),
 *  - стримы чата (UI регистрирует сам: key = sessionId).
 *
 * Нет записей — шторка ничего не показывает.
 * stopBg: runtime → kill сессии, cron → пауза задачи, delegate/stream → abort.
 */
import { killSession as rtKill } from "./runtime";

export type BgKind = "runtime" | "cron" | "delegate" | "stream";

export interface BgTask {
  kind: BgKind;
  /** Уникальный id: `runtime:<sessionId>`, `cron:<jobId>`, `delegate:<key>`, `stream:<sessionId>`. */
  id: string;
  /** Человеко-читаемая подпись для шторки. */
  label: string;
  startedAt: number;
  /** Для runtime — числовой sessionId (нужен kill). */
  sessionNum?: number;
}

interface RegEntry {
  kind: BgKind;
  label: string;
  startedAt: number;
  sessionNum?: number;
  stop: () => void | Promise<unknown>;
}

const registry = new Map<string, RegEntry>();

/**
 * Зарегистрировать фоновую работу. Возвращает unregister.
 * Перерегистрация того же id заменяет запись (без дублей).
 */
export function registerBg(
  kind: BgKind,
  id: string,
  label: string,
  stop: () => void | Promise<unknown>,
  sessionNum?: number,
): () => void {
  registry.set(id, { kind, label, startedAt: Date.now(), sessionNum, stop });
  return () => {
    registry.delete(id);
  };
}

/** Снять регистрацию (завершилось само). */
export function unregisterBg(id: string): void {
  registry.delete(id);
}

/**
 * Все запущенные прямо сейчас: реестр + включённые cron-задачи.
 * Cron — не «запущен», а «взведён»: показываем, чтобы было видно и останавливаемо.
 */
export async function listRunning(): Promise<BgTask[]> {
  const out: BgTask[] = [...registry.entries()].map(([id, e]) => ({
    kind: e.kind,
    id,
    label: e.label,
    startedAt: e.startedAt,
    sessionNum: e.sessionNum,
  }));
  try {
    const { loadJobs } = await import("./cron");
    const jobs = await loadJobs().catch(() => []);
    for (const j of jobs) {
      if (!j.enabled) continue;
      out.push({
        kind: "cron",
        id: `cron:${j.id}`,
        label: `Автозадача: ${j.name}`,
        startedAt: j.createdAt,
      });
    }
  } catch {}
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Остановить фоновую задачу. Возвращает true если что-то остановили.
 *  - runtime:<n> → kill нативной сессии + снять регистрацию;
 *  - stream:/delegate: → abort через зарегистрированный stop;
 *  - cron:<jobId> → пауза задачи (setJobEnabled false), из списка пропадёт.
 */
export async function stopBg(kind: BgKind, id: string): Promise<boolean> {
  if (kind === "cron") {
    const jobId = id.startsWith("cron:") ? id.slice(5) : id;
    try {
      const { setJobEnabled } = await import("./cron");
      const jobs = await (await import("./cron")).loadJobs().catch(() => []);
      const hit = jobs.find((j: { id: string }) => j.id === jobId);
      if (!hit) return false;
      await setJobEnabled(jobId, false);
      return true;
    } catch {
      return false;
    }
  }
  const e = registry.get(id);
  if (!e) return false;
  try {
    if (kind === "runtime" && typeof e.sessionNum === "number") {
      await rtKill(e.sessionNum).catch(() => false);
    } else {
      await e.stop();
    }
  } catch {}
  registry.delete(id);
  return true;
}

/** Сколько фоновых прямо сейчас (для тихого индикатора). */
export async function runningCount(): Promise<number> {
  return (await listRunning()).length;
}
