/**
 * AppIcon — минималистичный набор иконок приложения (свой, вместо эмодзи).
 *
 * Стиль: stroke 24×24, толщина 1.8, круглые концы и стыки, цвет через `color`
 * (currentColor). Заливки нет — только линия, одинаково читается в dark/light.
 * Рендер на react-native-svg — работает на Android, iOS и web.
 *
 * Движок не задет: чистый визуал, без логики.
 */
import React from "react";
import Svg, { Path, Circle, Ellipse, Line, Polyline, Rect } from "react-native-svg";

export const APP_ICON_NAMES = [
  "menu",
  "close",
  "check",
  "plus",
  "send",
  "mic",
  "folder",
  "settings",
  "model",
  "search",
  "chevron-right",
  "arrow-left",
  "edit",
  "delete",
  "copy",
  "share",
  "refresh",
  "image",
  "camera",
  "file",
  "terminal",
  "more",
  "info",
  "bell",
  "check-circle",
  "stop",
  "link",
  "box",
  "chevron-down",
  "folder-plus",
  "trend",
  "circle",
  "bulb",
  "chat",
  "eye",
  "bolt",
  "wrap",
  "home",
  "globe",
  "clock",
  "pen",
  "cube",
  "group",
  "gear",
  "account",
  "palette",
  "shield",
  "database",
  "board",
  "webhook",
  "message",
  "server",
] as const;

export type AppIconName = (typeof APP_ICON_NAMES)[number];

const STROKE_DEFAULT = 1.8;

function Shape({ name }: { name: AppIconName }) {
  switch (name) {
    case "menu":
      return (
        <>
          <Line x1="4" y1="7" x2="20" y2="7" />
          <Line x1="4" y1="12" x2="20" y2="12" />
          <Line x1="4" y1="17" x2="20" y2="17" />
        </>
      );
    case "close":
      return (
        <>
          <Line x1="6" y1="6" x2="18" y2="18" />
          <Line x1="18" y1="6" x2="6" y2="18" />
        </>
      );
    case "check":
      return <Polyline points="5 12.5 10 17.5 19 7" />;
    case "check-circle":
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" />
          <Polyline points="8.5 12.5 11.2 15.2 15.8 9.5" />
        </>
      );
    case "plus":
      return (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" />
          <Line x1="5" y1="12" x2="19" y2="12" />
        </>
      );
    case "send":
      return (
        <>
          <Line x1="12" y1="19" x2="12" y2="5" />
          <Polyline points="6.5 10.5 12 5 17.5 10.5" />
        </>
      );
    case "mic":
      return (
        <>
          <Rect x="9" y="3.5" width="6" height="10.5" rx="3" />
          <Path d="M6 11a6 6 0 0 0 12 0" />
          <Line x1="12" y1="17" x2="12" y2="20.5" />
        </>
      );
    case "folder":
      // LineArt-вариант (единый движок иконок).
      return <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />;
    case "settings":
      // LineArt-слайдеры: три линии с бегунками (единый движок иконок).
      return (
        <>
          <Line x1="4" y1="7" x2="20" y2="7" />
          <Circle cx="15" cy="7" r="2.2" />
          <Line x1="4" y1="12" x2="20" y2="12" />
          <Circle cx="9" cy="12" r="2.2" />
          <Line x1="4" y1="17" x2="20" y2="17" />
          <Circle cx="16" cy="17" r="2.2" />
        </>
      );
    case "gear":
      // LineArt-шестерёнка (единый движок иконок).
      return (
        <>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z" />
        </>
      );
    case "pen":
      // LineArt-перо (единый движок иконок).
      return (
        <>
          <Path d="M12 20h9" />
          <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      );
    case "cube":
      // LineArt-куб (единый движок иконок).
      return (
        <>
          <Path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3Z" />
          <Path d="M12 12l7.5-4.3M12 12L4.5 7.7M12 12v9" />
        </>
      );
    case "group":
      // LineArt-группа (единый движок иконок).
      return (
        <>
          <Circle cx="9" cy="8.5" r="3" />
          <Path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19" />
          <Circle cx="16.5" cy="9.5" r="2.3" />
          <Path d="M15.5 14.7c2.3.2 4 1.6 4.5 4" />
        </>
      );
    case "model":
      // Искра — выбор модели.
      return <Path d="M12 3.5l1.9 6.1 6.1 1.9-6.1 1.9L12 19.5l-1.9-6.1L4 11.5l6.1-1.9L12 3.5z" />;
    case "search":
      return (
        <>
          <Circle cx="11" cy="11" r="6.5" />
          <Line x1="15.8" y1="15.8" x2="20" y2="20" />
        </>
      );
    case "chevron-right":
      return <Polyline points="9.5 6 15.5 12 9.5 18" />;
    case "arrow-left":
      return (
        <>
          <Line x1="19" y1="12" x2="5" y2="12" />
          <Polyline points="10.5 6.5 5 12 10.5 17.5" />
        </>
      );
    case "edit":
      return <Path d="M14.5 5.5l4 4L8 20l-4.5.5L4 16l10.5-10.5z" />;
    case "delete":
      return (
        <>
          <Path d="M4.5 6.5h15" />
          <Path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
          <Path d="M6.5 6.5l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12" />
          <Line x1="10" y1="10.5" x2="10" y2="16.5" />
          <Line x1="14" y1="10.5" x2="14" y2="16.5" />
        </>
      );
    case "copy":
      return (
        <>
          <Rect x="9" y="9" width="11" height="11" rx="2" />
          <Path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
        </>
      );
    case "share":
      return (
        <>
          <Circle cx="6.5" cy="12" r="2.5" />
          <Circle cx="17" cy="6" r="2.5" />
          <Circle cx="17" cy="18" r="2.5" />
          <Line x1="8.7" y1="10.8" x2="14.8" y2="7.2" />
          <Line x1="8.7" y1="13.2" x2="14.8" y2="16.8" />
        </>
      );
    case "refresh":
      return <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 3.5v4h-4" />;
    case "image":
      return (
        <>
          <Rect x="3.5" y="5" width="17" height="14" rx="2" />
          <Circle cx="9" cy="10" r="1.6" />
          <Path d="M4.5 17.5l4.5-4.5 3 3 3.5-3.5 4 4" />
        </>
      );
    case "camera":
      return (
        <>
          <Path d="M4 8h3l2-2.5h6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8z" />
          <Circle cx="12" cy="13.5" r="3.2" />
        </>
      );
    case "file":
      return (
        <>
          <Path d="M6 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z" />
          <Path d="M13 3.5V8h4.5" />
        </>
      );
    case "terminal":
      return (
        <>
          <Polyline points="7 9 10.5 12 7 15" />
          <Line x1="12.5" y1="15.5" x2="17" y2="15.5" />
        </>
      );
    case "more":
      return (
        <>
          <Circle cx="5.5" cy="12" r="0.4" />
          <Circle cx="12" cy="12" r="0.4" />
          <Circle cx="18.5" cy="12" r="0.4" />
        </>
      );
    case "info":
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" />
          <Line x1="12" y1="11" x2="12" y2="16" />
          <Line x1="12" y1="7.8" x2="12" y2="8" />
        </>
      );
    case "bell":
      return <Path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16zM10 20.5a2.2 2.2 0 0 0 4 0" />;
    case "stop":
      return <Rect x="7" y="7" width="10" height="10" rx="2" />;
    case "chevron-down":
      return <Polyline points="6 9.5 12 15.5 18 9.5" />;
    case "folder-plus":
      return (
        <>
          <Path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7z" />
          <Line x1="16" y1="12" x2="16" y2="17" />
          <Line x1="13.5" y1="14.5" x2="18.5" y2="14.5" />
        </>
      );
    case "trend":
      return (
        <>
          <Polyline points="4 17 9.5 11.5 13.5 15.5 20 8" />
          <Path d="M15 8h5v5" />
        </>
      );
    case "circle":
      return <Circle cx="12" cy="12" r="8" />;
    case "bulb":
      return (
        <>
          <Path d="M12 3.5a5.5 5.5 0 0 1 3.2 10c-.7.5-1.2 1-1.2 2H10c0-1-.5-1.5-1.2-2A5.5 5.5 0 0 1 12 3.5z" />
          <Line x1="10" y1="18" x2="14" y2="18" />
          <Line x1="10.8" y1="20.5" x2="13.2" y2="20.5" />
        </>
      );
    case "chat":
      return <Path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V6.5z" />;
    case "eye":
      return (
        <>
          <Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
          <Circle cx="12" cy="12" r="2.5" />
        </>
      );
    case "bolt":
      return <Path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12L13 3z" />;
    case "wrap":
      return (
        <>
          <Path d="M3.5 7h13M3.5 12h8M3.5 17h13" />
          <Polyline points="17.5 10 20.5 12 17.5 14" />
        </>
      );
    case "home":
      return (
        <>
          <Path d="M4.5 11L12 4l7.5 7" />
          <Path d="M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
        </>
      );
    case "globe":
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" />
          <Path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5z" />
        </>
      );
    case "clock":
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" />
          <Polyline points="12 7.5 12 12 15 13.8" />
        </>
      );
    case "link":
      return (
        <>
          <Path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-5.6-5.6L12 6.8" />
          <Path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 5.6 5.6L12 17.2" />
        </>
      );
    case "box":
      return (
        <>
          <Path d="M3.5 8L12 3.5 20.5 8v8L12 20.5 3.5 16V8z" />
          <Path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" />
        </>
      );
    case "account":
      // Аккаунт и синхронизация: голова + плечи.
      return (
        <>
          <Circle cx="12" cy="8" r="3.5" />
          <Path d="M5 20c1-4 3.5-6 7-6s6 2 7 6" />
        </>
      );
    case "palette":
      // Внешний вид: палитра + точки красок.
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" />
          <Circle cx="9" cy="10" r="0.4" />
          <Circle cx="12.5" cy="8.8" r="0.4" />
          <Circle cx="15.5" cy="11" r="0.4" />
          <Path d="M12 20.5c-1.5-1-2-2.2-2-3.5" />
        </>
      );
    case "shield":
      // Безопасность: щит + галочка.
      return (
        <>
          <Path d="M12 3.5l7 2.5v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10v-5l7-2.5z" />
          <Polyline points="9.5 11.8 11.3 13.6 14.8 9.8" />
        </>
      );
    case "database":
      // Данные/backup: цилиндр БД.
      return (
        <>
          <Ellipse cx="12" cy="6" rx="7" ry="2.8" />
          <Path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
          <Path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
        </>
      );
    case "board":
      // Kanban-доска: рамка + 2 колонки.
      return (
        <>
          <Rect x="4" y="4" width="16" height="16" rx="2" />
          <Line x1="9.3" y1="4" x2="9.3" y2="20" />
          <Line x1="14.6" y1="4" x2="14.6" y2="20" />
        </>
      );
    case "webhook":
      // Вебхуки: broadcast-дуги + точка.
      return (
        <>
          <Circle cx="12" cy="18" r="0.4" />
          <Path d="M8.5 14.5a5 5 0 0 1 7 0" />
          <Path d="M6 12a9 9 0 0 1 12 0" />
        </>
      );
    case "message":
      // Мессенджеры: облачко с точками (chat — пустое облачко).
      return (
        <>
          <Path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V5.5z" />
          <Circle cx="8.5" cy="9" r="0.4" />
          <Circle cx="12" cy="9" r="0.4" />
          <Circle cx="15.5" cy="9" r="0.4" />
        </>
      );
    case "server":
      // MCP-серверы / свои провайдеры: стойка из двух юнитов.
      return (
        <>
          <Rect x="4" y="4" width="16" height="6.5" rx="1.5" />
          <Rect x="4" y="13.5" width="16" height="6.5" rx="1.5" />
          <Circle cx="7.5" cy="7.2" r="0.4" />
          <Circle cx="7.5" cy="16.7" r="0.4" />
        </>
      );
  }
}

/**
 * Мост со старых MaterialIcons-имён на AppIcon.
 * Для динамических мест (ToolCard meta, AgentScreen-данные), где имена
 * приходят из данных. Неизвестное имя → "more" (нейтральные точки).
 */
const MATERIAL_TO_APP: Record<string, AppIconName> = {
  menu: "menu",
  close: "close",
  check: "check",
  "check-circle": "check-circle",
  add: "plus",
  "arrow-upward": "send",
  send: "send",
  mic: "mic",
  stop: "stop",
  folder: "folder",
  "folder-open": "folder",
  "create-new-folder": "folder-plus",
  settings: "settings",
  search: "search",
  "chevron-right": "chevron-right",
  "expand-more": "chevron-down",
  "keyboard-arrow-down": "chevron-down",
  "arrow-back": "arrow-left",
  edit: "edit",
  delete: "delete",
  "delete-outline": "delete",
  "delete-sweep": "delete",
  copy: "copy",
  "content-copy": "copy",
  share: "share",
  refresh: "refresh",
  autorenew: "refresh",
  "restart-alt": "refresh",
  image: "image",
  "photo-library": "image",
  camera: "camera",
  "photo-camera": "camera",
  "center-focus-strong": "camera",
  file: "file",
  "insert-drive-file": "file",
  description: "file",
  "note-add": "file",
  archive: "box",
  terminal: "terminal",
  code: "terminal",
  model: "model",
  "smart-toy": "model",
  extension: "model",
  link: "link",
  cloud: "link",
  "cloud-done": "link",
  language: "globe",
  box: "box",
  storage: "box",
  checklist: "check",
  info: "info",
  "info-outline": "info",
  "help-outline": "info",
  bell: "bell",
  notifications: "bell",
  bolt: "bolt",
  "battery-charging-full": "bolt",
  trend: "trend",
  "trending-up": "trend",
  circle: "circle",
  "radio-button-unchecked": "circle",
  bulb: "bulb",
  lightbulb: "bulb",
  memory: "bulb",
  chat: "chat",
  "chat-bubble-outline": "chat",
  eye: "eye",
  visibility: "eye",
  wrap: "wrap",
  "wrap-text": "wrap",
  home: "home",
  globe: "globe",
  clock: "clock",
  schedule: "clock",
  psychology: "terminal",
  groups: "more",
  "more-vert": "more",
  pen: "pen",
  cube: "cube",
  group: "group",
  gear: "gear",
  account: "account",
  palette: "palette",
  shield: "shield",
  database: "database",
  board: "board",
  webhook: "webhook",
  message: "message",
  server: "server",
  person: "account",
  "account-circle": "account",
  "admin-panel-settings": "shield",
  security: "shield",
  "data-usage": "database",
  "view-kanban": "board",
  "view-column": "board",
  forum: "message",
  sms: "message",
  dns: "server",
  "storage-server": "server",
};

export function materialToApp(name: string): AppIconName {
  return MATERIAL_TO_APP[name] ?? "more";
}

export function AppIcon({
  name,
  size = 22,
  color = "#fff",
  strokeWidth = STROKE_DEFAULT,
}: {
  name: AppIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  // Stroke задаём один раз на Svg — фигуры наследуют, не дублируют атрибуты.
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Shape name={name} />
    </Svg>
  );
}
