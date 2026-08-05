/**
 * Тема-токены: светлая (Paper) и тёмная (Amber Night).
 * Палитры из утверждённого макета 004 — один дизайн, две темы.
 */
export type ThemeName = "light" | "dark";

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
}

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: "dark",
    bg: "#1c1917",
    surface: "#242019",
    surface2: "#2e2923",
    border: "#3a342c",
    text: "#f5f1ea",
    dim: "#a89f91",
    mute: "#6f675d",
    accent: "#d97706",
    accentHi: "#f59e0b",
    accentDim: "rgba(217,119,6,.13)",
    onAccent: "#1c1202",
    ripple: "rgba(255,255,255,.14)",
    userBubble: "#7c4a03",
    userText: "#ffe9c7",
    codeBg: "#171412",
    codeText: "#fde3b3",
    scrim: "rgba(0,0,0,.55)",
    danger: "#ef4444",
    ok: "#4ade80",
  },
  light: {
    name: "light",
    bg: "#faf7f2",
    surface: "#ffffff",
    surface2: "#f3eee5",
    border: "#e8e0d3",
    text: "#241f1a",
    dim: "#7d7365",
    mute: "#b0a594",
    accent: "#b4531f",
    accentHi: "#c45b2e",
    accentDim: "rgba(180,83,31,.09)",
    onAccent: "#fff8ef",
    ripple: "rgba(36,31,26,.12)",
    userBubble: "#e7dcc9",
    userText: "#4a3f2f",
    codeBg: "#f3eee5",
    codeText: "#3d362c",
    scrim: "rgba(60,45,25,.2)",
    danger: "#dc2626",
    ok: "#4a6b3c",
  },
};
