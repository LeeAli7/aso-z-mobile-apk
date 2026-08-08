/**
 * Дизайн-токены: сетка, радиусы, длительности, тач-таргеты.
 * Используются ВСЕМИ компонентами дизайн-системы.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 99,
} as const;

export const durations = {
  fast: 120,
  med: 200,
  slow: 320,
} as const;

/** Минимальный тач-таргет (Material Design: 44×44). */
export const touchTarget = 44;

/** HitSlop для мелких иконок — расширяет зону нажатия. */
export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

/** Человекочитаемый размер файла: 2097152 → "2.0 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
