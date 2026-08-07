/**
 * Тема-токены в стиле Kimi (Moonshot AI).
 * Значения — из официальной дизайн-системы kimi-widget (widget_foundation.css
 * из APK): KMBlue #1783ff/#1a88ff, тёмный #121212/#1f1f1f, светлый #fff/#f5f5f5.
 * Один дизайн, две темы.
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
  danger: string;
  ok: string;
  /** Доп. цвета Kimi: предупреждение, фиолетовый (агент), оранжевый */
  warn: string;
  purple: string;
}

export const themes: Record<"light" | "dark", Theme> = {
  dark: {
    name: "dark",
    bg: "#0d0d0d",
    surface: "#1b1b1d",
    surface2: "#26262a",
    border: "rgba(255,255,255,.12)",
    text: "rgba(255,255,255,.88)",
    dim: "rgba(255,255,255,.56)",
    mute: "rgba(255,255,255,.38)",
    accent: "#1a88ff",
    accentHi: "#4da6ff",
    accentDim: "rgba(26,136,255,.16)",
    onAccent: "#ffffff",
    ripple: "rgba(255,255,255,.12)",
    userBubble: "#1a88ff",
    userText: "#ffffff",
    codeBg: "#0a0a0a",
    codeText: "#d4d4d4",
    scrim: "rgba(0,0,0,.72)",
    danger: "#ff3849",
    ok: "#16c456",
    warn: "#ffd230",
    purple: "#a16bff",
  },
  light: {
    name: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    surface2: "#f5f5f5",
    border: "rgba(0,0,0,.13)",
    text: "rgba(0,0,0,.9)",
    dim: "rgba(0,0,0,.6)",
    mute: "rgba(0,0,0,.45)",
    accent: "#1783ff",
    accentHi: "#0066d6",
    accentDim: "rgba(23,131,255,.1)",
    onAccent: "#ffffff",
    ripple: "rgba(0,0,0,.1)",
    userBubble: "#1783ff",
    userText: "#ffffff",
    // Код-блоки всегда тёмные (как в Kimi/VS Code), независимо от темы.
    codeBg: "#1e1e1e",
    codeText: "#d4d4d4",
    scrim: "rgba(0,0,0,.5)",
    danger: "#ff3849",
    ok: "#16c456",
    warn: "#ff9500",
    purple: "#985ffb",
  },
};
