/**
 * Тема-токены «КРОВЬ».
 *
 * Система: чёрный фон, карточки #141416, «снег» — белый текст,
 * «кровь» #FF3B30 — единственный цветной акцент и только по делу:
 * ошибка, подтверждение, разрушительное действие.
 * Главное действие — белая капсула с чёрным текстом, не цветная кнопка.
 */
/** "system" резолвится в light/dark через Appearance (см. AppStore). */
export type ThemeName = "light" | "dark" | "system";

export interface Theme {
  name: ThemeName;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  dim: string;
  mute: string;
  /** Главное действие: в КРОВИ это белая капсула. */
  accent: string;
  accentHi: string;
  accentDim: string;
  /** Цвет текста НА accent-фоне (кнопки primary) */
  onAccent: string;
  /** Цвет ripple-эффекта (полупрозрачный) */
  ripple: string;
  userBubble: string;
  userText: string;
  codeBg: string;
  codeText: string;
  scrim: string;
  /** Кровь: ошибки и разрушительные действия. */
  danger: string;
  ok: string;
  warn: string;
  purple: string;
}

export const fonts = {
  /** Основной текст интерфейса. */
  sansMedium: "MiSansLatin-Medium",
  sansDemi: "MiSansLatin-Demibold",
  /** Моноширинный — ID, команды, терминал. */
  mono: "GeistMono",
  monoItalic: "GeistMono-Italic",
  /** Пиксельный, для ретро-заголовков. */
  pixel: "PixelifySans",
} as const;

export const themes: Record<"light" | "dark", Theme> = {
  // «КРОВЬ» — основной вид приложения.
  dark: {
    name: "dark",
    bg: "#000000",
    surface: "#141416",
    surface2: "#1c1c1f",
    border: "rgba(255,255,255,.09)",
    text: "#ffffff",
    dim: "rgba(235,235,245,.45)",
    mute: "rgba(235,235,245,.28)",
    accent: "#ffffff",
    accentHi: "#ededf0",
    accentDim: "rgba(255,255,255,.10)",
    onAccent: "#000000",
    ripple: "rgba(255,255,255,.10)",
    userBubble: "#1f1f22",
    userText: "#ffffff",
    codeBg: "#0a0a0b",
    codeText: "#e6e6ea",
    scrim: "rgba(0,0,0,.62)",
    danger: "#FF3B30",
    ok: "#ffffff",
    warn: "#8e8e93",
    purple: "#8e8e93",
  },
  // Светлый вариант той же системы — без цвета, с той же кровью.
  light: {
    name: "light",
    bg: "#ffffff",
    surface: "#f5f5f7",
    surface2: "#ececef",
    border: "rgba(0,0,0,.10)",
    text: "#000000",
    dim: "rgba(0,0,0,.52)",
    mute: "rgba(0,0,0,.34)",
    accent: "#000000",
    accentHi: "#1c1c1f",
    accentDim: "rgba(0,0,0,.06)",
    onAccent: "#ffffff",
    ripple: "rgba(0,0,0,.08)",
    userBubble: "#ececef",
    userText: "#000000",
    codeBg: "#0a0a0b",
    codeText: "#e6e6ea",
    scrim: "rgba(0,0,0,.45)",
    danger: "#FF3B30",
    ok: "#000000",
    warn: "#8e8e93",
    purple: "#8e8e93",
  },
};
