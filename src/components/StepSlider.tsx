import React, { useCallback, useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { tap as hapticTap } from "../core/haptics";
import { fonts } from "../theme/tokens";

/**
 * Ступенчатый ползунок на чистом PanResponder.
 *
 * Почему не locationX (из-за этого он «дёргался»): locationX в move-событии
 * считается относительно вьюхи ПОД пальцем, а под пальцем оказываются разные
 * дети (заливка, головка, тики) — значение прыгало. Здесь берём pageX (экранная
 * координата, от детей не зависит) и вычитаем измеренный левый край дорожки.
 * Жест создаётся один раз, чтобы смена шага не пересобирала обработчик.
 */
type Props = {
  /** подпись строки, 11 px, капсом */
  caption: string;
  /** крупное значение под подписью */
  value: string;
  /** подписи шагов */
  steps: string[];
  /** индекс выбранного шага */
  index: number;
  /** примечание моно внизу */
  note?: string;
  /** подписи только по краям (контекст) */
  labelsMode?: "none" | "ends";
  /** цвет заливки дорожки */
  color: string;
  text: string;
  dim: string;
  onCommit: (i: number) => void;
};

const PAD = 9; // головка 18 → её центр не должен выезжать за дорожку

export function StepSlider({
  caption,
  value,
  steps,
  index,
  note,
  labelsMode = "none",
  color,
  text,
  dim,
  onCommit,
}: Props) {
  const [w, setW] = useState(0);
  const [pos, setPos] = useState(() => (steps.length > 1 ? index / (steps.length - 1) : 0));
  const x0 = useRef(0);
  const countRef = useRef(steps.length);
  countRef.current = steps.length;
  const idxRef = useRef(index);
  const cbRef = useRef(onCommit);
  cbRef.current = onCommit;
  const posRef = useRef(pos);
  posRef.current = pos;
  const wrap = useRef<View>(null);

  useEffect(() => {
    const p = steps.length > 1 ? index / (steps.length - 1) : 0;
    setPos(p);
    idxRef.current = index;
  }, [index, steps.length]);

  const measure = useCallback(() => {
    wrap.current?.measureInWindow((x) => {
      x0.current = x;
    });
  }, []);

  const pick = useCallback((pageX: number) => {
    const n = countRef.current;
    const span = wRef.current - PAD * 2;
    if (n < 2 || span <= 0) return;
    const t = Math.max(0, Math.min(1, (pageX - x0.current - PAD) / span));
    const i = Math.round(t * (n - 1));
    setPos(i / (n - 1));
    if (i !== idxRef.current) {
      idxRef.current = i;
      hapticTap();
      cbRef.current(i);
    }
  }, []);

  const wRef = useRef(w);
  wRef.current = w;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        measure();
        pick(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => pick(e.nativeEvent.pageX),
      onPanResponderRelease: (e) => pick(e.nativeEvent.pageX),
    }),
  ).current;

  const n = steps.length;
  const knob = PAD + pos * Math.max(0, w - PAD * 2);
  // пока дорожка не измерена, головка и заливка невидимы: иначе первый кадр
  // рисует их у левого края, и ползунок «прыгает» из нуля в значение
  const ready = w > 0;

  return (
    <View>
      <Text style={[styles.caption, { color: dim }]}>{caption.toUpperCase()}</Text>
      <Text style={[styles.value, { color: text }]}>{value}</Text>

      <View
        ref={wrap}
        onLayout={(e) => {
          setW(e.nativeEvent.layout.width);
          measure();
        }}
        {...pan.panHandlers}
        style={styles.track}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, right: 0, top: 10, height: 4, borderRadius: 2,
            backgroundColor: "rgba(237,237,239,0.14)",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, top: 10, height: 4, borderRadius: 2,
            width: Math.max(0, PAD + pos * Math.max(0, w - PAD * 2)),
            backgroundColor: color,
            opacity: ready ? 1 : 0,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute", top: 3, left: knob - PAD, width: 18, height: 18, borderRadius: 9,
            backgroundColor: text,
            opacity: ready ? 1 : 0,
          }}
        />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: PAD }}>
        {Array.from({ length: n }).map((_, i) => (
          <View
            key={i}
            style={{
              width: 2, height: 5, borderRadius: 1,
              backgroundColor: i / Math.max(1, n - 1) <= pos + 0.001 ? "rgba(237,237,239,0.55)" : "rgba(237,237,239,0.16)",
            }}
          />
        ))}
      </View>

      {labelsMode === "ends" ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingHorizontal: PAD }}>
          <Text style={[styles.label, { color: dim }]}>{steps[0]}</Text>
          <Text style={[styles.label, { color: dim }]}>{steps[n - 1]}</Text>
        </View>
      ) : null}

      {note ? <Text style={[styles.note, { color: dim }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 11, letterSpacing: 1, fontFamily: fonts.sansMedium },
  value: { fontSize: 17, fontFamily: fonts.sansDemi, marginTop: 8 },
  track: { height: 24, justifyContent: "center", marginTop: 8 },
  label: { fontSize: 11, fontFamily: fonts.sansMedium },
  note: { fontSize: 11.5, fontFamily: fonts.mono, marginTop: 12 },
});
