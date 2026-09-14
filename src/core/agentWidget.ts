/**
 * agentWidget.ts — движок виджета активности агента (foreground-уведомление).
 *
 * Hermes показывает статус агента в десктопе/TUI; на Android аналог —
 * persistent notification «агент активен»: статус, прогресс, кнопка Стоп.
 * Этот модуль — движковая сторона: состояние + подписка. Нативный показ
 * (expo-notifications / foreground-service) подключает UI-слой поверх
 * getSnapshot/subscribe. Без нативного модуля — no-op, UI скрывает виджет.
 */
export interface AgentActivity {
  /** Агент сейчас работает (стрим/тулы/команда). */
  active: boolean;
  /** Короткий статус: «думаю», «пишу файл», «выполняю команду»… */
  status: string;
  /** Прогресс 0..1 (если известен), иначе null. */
  progress: number | null;
  /** Когда началось (ms), null = неактивно. */
  startedAt: number | null;
}

type Listener = (a: AgentActivity) => void;

const state: AgentActivity = { active: false, status: "", progress: null, startedAt: null };
const listeners = new Set<Listener>();
/** AbortController текущей работы — для кнопки Стоп из уведомления. */
let stopHandle: (() => void) | null = null;

function emit(): void {
  for (const l of [...listeners]) {
    try {
      l({ ...state });
    } catch {}
  }
}

export function subscribeActivity(l: Listener): () => void {
  listeners.add(l);
  try {
    l({ ...state });
  } catch {}
  return () => {
    listeners.delete(l);
  };
}

export function getActivity(): AgentActivity {
  return { ...state };
}

/** Агент начал работу. Возвращает stop-функцию для уведомления. */
export function activityStart(status: string, onStop?: () => void): () => void {
  state.active = true;
  state.status = status;
  state.progress = null;
  state.startedAt = Date.now();
  stopHandle = onStop ?? null;
  emit();
  return () => activityStop();
}

export function activityUpdate(status: string, progress?: number | null): void {
  if (!state.active) return;
  state.status = status;
  if (typeof progress === "number") state.progress = Math.max(0, Math.min(1, progress));
  emit();
}

export function activityStop(): void {
  if (!state.active) return;
  state.active = false;
  state.status = "";
  state.progress = null;
  state.startedAt = null;
  try {
    stopHandle?.();
  } catch {}
  stopHandle = null;
  emit();
}
