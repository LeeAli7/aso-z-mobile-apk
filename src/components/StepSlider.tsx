import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { fonts, type Theme } from "../theme/tokens";

/** Поле головки за дорожку: дорожка = ширина блока − 18. */
const PAD = 9;

/**
 * Ползунок по ступеням — тот же, что в макетах окна параметров.
 *
 * Геометрия из макета: дорожка 4 px, головка 18, выступает на 9 за дорожку,
 * засечки 2×5, подписи под ними. Шаги равномерны по индексу, значения — нет.
 *
 * Движение считаем по координате ЖЕСТА (e.x), а не по locationX: у PanResponder
 * locationX прыгает между вложенными вьюхами, и ползунок «сходил с ума».
 */
export function StepSlider({
  value,
  steps,
  onCommit,
  theme,
  unit,
  note,
  caption,
  labelsMode = "none",
}: {
  /** индекс ступени */
  value: number;
  steps: string[];
  onCommit: (index: number) => void;
  theme: Theme;
  /** вторая строка рядом со значением (например, «тыс. токенов») */
  unit?: string;
  /** пояснение под шкалой, моно 11.5 */
  note?: string;
  /** подпись над значением (верхний регистр) */
  caption: string;
  /** «none» — подписей нет, «ends» — только края, «all» — каждая засечка */
  labelsMode?: "none" | "all" | "ends";
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const last = useRef(value);
  const pos = useSharedValue(steps.length > 1 ? value / (steps.length - 1) : 0);
  const rootRef = useRef<View>(null);

  // колбэк в ref: сам жест НЕ пересоздаётся при каждом шаге, иначе
  // RNGH пересобирает обработчик посреди протяжки и ползунок «дёргается»
  const cbRef = useRef(onCommit);
  cbRef.current = onCommit;
  const countRef = useRef(steps.length);
  countRef.current = steps.length;

  const commit = useCallback((i: number) => {
    if (i !== last.current) {
      last.current = i;
      void Haptics.selectionAsync().catch(() => {});
      cbRef.current(i);
    }
  }, []);

  // значение пришло снаружи (загрузились настройки модели) — головка едет туда
  useEffect(() => {
    const k = steps.length > 1 ? value / (steps.length - 1) : 0;
    if (last.current !== value) last.current = value;
    pos.value = withTiming(k, { duration: 160 });
  }, [value, steps.length, pos]);

  const span = () => Math.max(1, wRef.current - 2 * PAD);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          const n = countRef.current;
          const i = Math.max(0, Math.min(n - 1, Math.round((e.x - PAD) / span() * (n - 1))));
          pos.value = withTiming(i / (n - 1), { duration: 90 });
          runOnJS(commit)(i);
        })
        .onUpdate((e) => {
          const n = countRef.current;
          const t = Math.max(0, Math.min(1, (e.x - PAD) / span()));
          const i = Math.round(t * (n - 1));
          pos.value = i / (n - 1);
          runOnJS(commit)(i);
        }),
    [commit, pos],
  );

  const fill = useAnimatedStyle(() => ({ width: pos.value * (w - 2 * PAD) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * (w - 2 * PAD) }] }));

  const n = steps.length;
  const pctOf = (i: number) => (n > 1 ? i / (n - 1) : 0);

  return (
    <View style={{ paddingTop: 12 }}>
      <Text style={{ color: theme.mute, fontSize: 11, letterSpacing: 0.9, fontFamily: fonts.sansMedium }}>
        {caption.toUpperCase()}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <Text style={{ color: theme.text, fontSize: 17, letterSpacing: -0.2, fontFamily: fonts.sansDemi }}>
          {steps[value]}
        </Text>
        {unit ? <Text style={{ color: theme.dim, fontSize: 12.5 }}>{unit}</Text> : null}
      </View>

      <View>
        <GestureDetector gesture={pan}>
          <View
            ref={rootRef}
            onLayout={(e) => {
              const nw = e.nativeEvent.layout.width;
              wRef.current = nw;
              setW(nw);
            }}
            style={{ height: 22, justifyContent: "center", marginTop: 14 }}
          >
            <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.surface2 }} />
            <Reanimated.View
              style={[{ position: "absolute", left: PAD, height: 4, borderRadius: 2, backgroundColor: theme.text }, fill]}
            />
            <Reanimated.View
              style={[
                {
                  position: "absolute",
                  left: PAD - 9,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: theme.text,
                },
                knob,
              ]}
            />
          </View>
        </GestureDetector>

        {/* засечки под дорожкой */}
        <View style={{ height: 5, marginTop: 2, marginHorizontal: PAD }}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                left: `${pctOf(i) * 100}%`,
                marginLeft: -1,
                width: 2,
                height: 5,
                borderRadius: 1,
                backgroundColor: i <= value ? theme.dim : theme.border,
              }}
            />
          ))}
        </View>

        {/* подписи: у рассуждения их нет вовсе, у контекста только края */}
        {labelsMode !== "none" ? (
        <View style={{ height: 14, marginTop: 6, marginHorizontal: PAD }}>
          {steps.map((s, i) => {
            if (labelsMode === "ends" && i !== 0 && i !== n - 1) return null;
            const left = pctOf(i) * 100;
            return (
              <Text
                key={i}
                numberOfLines={1}
                style={[
                  {
                    position: "absolute",
                    fontSize: 11,
                    color: i === value ? theme.text : theme.mute,
                    fontFamily: fonts.sansMedium,
                  },
                  i === 0
                    ? { left: 0 }
                    : i === n - 1
                      ? { right: 0 }
                      : { left: `${left}%`, transform: [{ translateX: -24 }] },
                ]}
              >
                {s}
              </Text>
            );
          })}
        </View>
        ) : null}
      </View>

      {note ? (
        <Text
          style={{
            color: theme.mute,
            fontSize: 11.5,
            lineHeight: 16,
            paddingTop: 12,
            fontFamily: fonts.mono,
          }}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}
