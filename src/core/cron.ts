/**
 * cron.ts — автозадачи агента (как Hermes cron).
 *
 * В мобильном приложении фоновые задачи ограничены ОС, поэтому:
 *  - планировщик тикает, пока приложение активно (setInterval),
 *  - при старте приложения проверяются «пропущенные» задачи (catch-up),
 *  - выполнение задачи = агентский ход (функция-обработчик, переданная из UI).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CronJob {
  id: string;
  name: string;
  /** '30m' | 'every 2h' | '0 9 * * *' (cron-5-полей) | ISO (once) */
  schedule: string;
  /** Инструкция/промпт автозадачи. */
  prompt: string;
  enabled: boolean;
  once?: boolean;
  lastRunAt: number | null;
  createdAt: number;
  /** Куда доставлять: 'chat' (в чат) | 'local' (только сохранить). */
  deliver: "chat" | "local";
  /** Последний результат (для UI). */
  lastResult?: string | null;
}

const KEY = "aso_cron_jobs";

function genId(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function loadJobs(): Promise<CronJob[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CronJob[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveJobs(jobs: CronJob[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    // не критично
  }
}

export async function upsertJob(
  job: Partial<CronJob> & { name: string; schedule: string; prompt: string },
): Promise<CronJob> {
  const jobs = await loadJobs();
  if (job.id) {
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      const merged = { ...jobs[idx], ...job } as CronJob;
      jobs[idx] = merged;
      await saveJobs(jobs);
      return merged;
    }
  }
  const created: CronJob = {
    id: genId(),
    name: job.name,
    schedule: job.schedule,
    prompt: job.prompt,
    enabled: job.enabled !== false,
    once: !!job.once,
    lastRunAt: null,
    createdAt: Date.now(),
    deliver: job.deliver ?? "chat",
  };
  jobs.push(created);
  await saveJobs(jobs);
  return created;
}

export async function removeJob(id: string): Promise<void> {
  const jobs = await loadJobs();
  await saveJobs(jobs.filter((j) => j.id !== id));
}

export async function setJobEnabled(id: string, enabled: boolean): Promise<void> {
  const jobs = await loadJobs();
  const j = jobs.find((x) => x.id === id);
  if (j) {
    j.enabled = enabled;
    await saveJobs(jobs);
  }
}

export async function markJobRun(id: string, result: string): Promise<void> {
  const jobs = await loadJobs();
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  j.lastRunAt = Date.now();
  j.lastResult = result.slice(0, 500);
  if (j.once) j.enabled = false;
  await saveJobs(jobs);
}

/** Парсит расписание → следующий запуск (ms). null = невалидно. */
export function nextRunAt(job: CronJob, now: number = Date.now()): number | null {
  if (!job.enabled) return null;
  const s = job.schedule.trim();

  // ISO (once)
  const iso = Date.parse(s);
  if (!Number.isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return iso > now ? iso : null;
  }

  // '30m' — интервал в минутах
  let m = s.match(/^(\d+)\s*m$/i);
  if (m) {
    const intervalMin = parseInt(m[1], 10);
    if (intervalMin <= 0) return null;
    const last = job.lastRunAt ?? now;
    // следующий после последнего запуска
    return last + intervalMin * 60_000;
  }

  // 'every 2h' — интервал в часах
  m = s.match(/^every\s+(\d+)\s*h$/i);
  if (m) {
    const intervalH = parseInt(m[1], 10);
    if (intervalH <= 0) return null;
    const last = job.lastRunAt ?? now;
    return last + intervalH * 3600_000;
  }

  // cron-5-полей: '0 9 * * *'
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const base = new Date(job.lastRunAt ?? now);
    return cronNext(parts, base);
  }

  return null;
}

function cronNext(parts: string[], from: Date): number {
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (
      cronMatch(parts[0], d.getMinutes()) &&
      cronMatch(parts[1], d.getHours()) &&
      cronMatch(parts[2], d.getDate()) &&
      cronMatch(parts[3], d.getMonth() + 1) &&
      cronMatch(parts[4], d.getDay())
    ) {
      return d.getTime();
    }
  }
  return Date.now() + 24 * 3600_000;
}

function cronMatch(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.includes(",")) return field.split(",").some((f) => cronMatch(f, value));
  if (field.includes("-")) {
    const [a, b] = field.split("-").map((x) => parseInt(x, 10));
    return value >= a && value <= b;
  }
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }
  return parseInt(field, 10) === value;
}

/** Джобы, которые пора запустить (учитывая catch-up после простоя). */
export async function dueJobs(now: number = Date.now()): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => {
    const next = nextRunAt(j, now);
    if (next === null) return false;
    // запускаем, если следующий запуск <= now  И  с последнего прошло >= интервал
    // (catch-up: интервальные задачи после паузы не «догоняют» каждый тик)
    return next <= now && (j.lastRunAt === null || now - (j.lastRunAt ?? 0) >= 1000);
  });
}

/** Следующие запуски для UI (форматировано). */
export async function upcoming(jobs: CronJob[], now: number = Date.now()): Promise<string[]> {
  return jobs
    .filter((j) => j.enabled)
    .map((j) => {
      const n = nextRunAt(j, now);
      if (n === null) return `${j.name}: —`;
      const mins = Math.round((n - now) / 60_000);
      if (mins < 1) return `${j.name}: меньше минуты`;
      if (mins < 60) return `${j.name}: через ${mins} мин`;
      const h = Math.floor(mins / 60);
      const mm = mins % 60;
      return `${j.name}: через ${h} ч ${mm} мин`;
    });
}

export async function clearJobs(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}