/**
 * Icon — минималистичная SVG-иконка, единый стиль всего приложения.
 *
 * Спецификация: viewBox 24×24, stroke 1.5, круглые концы/стыки,
 * цвет — currentColor (задаётся пропсом `color`).
 * Требуется: npx expo install react-native-svg
 */
import React from "react";
import { Svg, Path, Circle, Rect, Line } from "react-native-svg";
import { ICONS, type IconEl, type IconName } from "./iconPaths";

export type { IconName };

const STROKE = 1.5;

function renderEl(el: IconEl, color: string, key: number) {
  switch (el.t) {
    case "p":
      return <Path key={key} d={el.d} stroke={color} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "c":
      return <Circle key={key} cx={el.cx} cy={el.cy} r={el.r} stroke={color} strokeWidth={STROKE} fill="none" />;
    case "r":
      return <Rect key={key} x={el.x} y={el.y} width={el.w} height={el.h} rx={el.rx} stroke={color} strokeWidth={STROKE} fill="none" />;
    case "l":
      return <Line key={key} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={color} strokeWidth={STROKE} strokeLinecap="round" />;
  }
}

export function Icon({
  name,
  size = 22,
  color = "#fff",
  strokeWidth,
  accessibilityLabel,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Переопределение толщины (по умолчанию 1.5 по спеке). */
  strokeWidth?: number;
  accessibilityLabel?: string;
}) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  if (glyph.filled) {
    // stop: залитый квадрат, цвет = color, stroke не нужен
    const r = glyph.els[0] as Extract<IconEl, { t: "r" }>;
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={accessibilityLabel}>
        <Rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill={color} />
      </Svg>
    );
  }
  const w = strokeWidth ?? STROKE;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel={accessibilityLabel}>
      {glyph.els.map((el, i) => {
        if (el.t === "p")
          return <Path key={i} d={el.d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
        if (el.t === "c")
          return <Circle key={i} cx={el.cx} cy={el.cy} r={el.r} stroke={color} strokeWidth={w} fill="none" />;
        if (el.t === "r")
          return <Rect key={i} x={el.x} y={el.y} width={el.w} height={el.h} rx={el.rx} stroke={color} strokeWidth={w} fill="none" />;
        return <Line key={i} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={color} strokeWidth={w} strokeLinecap="round" />;
      })}
    </Svg>
  );
}
