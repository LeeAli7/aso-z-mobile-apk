/**
 * PillSwapLoader — «role swap» 1:1 с референса pill-loaders.html (блок 1).
 *
 * Белая капсула, в ней красный бегун растёт до целой капсулы; затем роли
 * меняются — кирпич становится красным, по нему едет белый бегун, на краю
 * рождается белая точка. Капсула смещается, наклоняется и дышит в такт ходу.
 *
 * Всё считается на UI-потоке (reanimated useFrameCallback), без setState.
 * Базовые координаты референса: сцена 380×260, центр (190,130), капсула
 * tube(-60, 60, 40). Наружу не отдаёт ни шрифтов, ни фона — только фигуры.
 */
import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

const RED = "#FF3B30";
const WHITE = "#FFFFFF";

const BASE_W = 380;
const BASE_H = 260;
const HALF = 1.5; // секунд на половину цикла

function cl(x: number) {
  "worklet";
  return Math.max(0, Math.min(1, x));
}
function ease(t: number) {
  "worklet";
  t = cl(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeBack(t: number) {
  "worklet";
  t = cl(t);
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

type Props = {
  /** 1 = капсула 200×80 в базовых координатах */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function PillSwapLoader({ size = 1, style }: Props) {
  const t = useSharedValue(0);

  useFrameCallback((info) => {
    "worklet";
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    t.value = (t.value + dt) % (2 * HALF);
  }, true);

  // общая группа: сдвиг → наклон → пульс
  const groupStyle = useAnimatedStyle(() => {
    const cyc = t.value;
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;
    const p = ease(cl((u - 0.14) / 0.54));
    const ant = ease(cl(u / 0.14)) * (1 - cl((u - 0.14) / 0.1));
    const pop = cl((u - 0.68) / 0.25);
    const sc = 1 + 0.09 * Math.sin(Math.PI * pop) * (1 - pop * 0.4);
    const ang = ((20 - sg * 8 * Math.sin(Math.PI * p)) * Math.PI) / 180;
    return {
      transform: [
        { translateX: -sg * 16 * Math.sin(Math.PI * p) },
        { translateY: -10 * Math.sin(Math.PI * p) },
        { rotate: `${ang}rad` },
        { scaleX: sc * (1 - 0.08 * ant) },
        { scaleY: sc * (1 + 0.1 * ant) },
      ],
    };
  });

  // базовая капсула tube(-60, 60, 40)
  const baseStyle = useAnimatedStyle(() => {
    const cyc = t.value;
    const half = cyc < HALF ? 0 : 1;
    return {
      backgroundColor: half ? RED : WHITE,
      left: -100,
      top: -40,
      width: 200,
      height: 80,
      borderRadius: 40,
    };
  });

  // бегун tube(sg*xg, sg*60, (26 + 14p) * (1 - 0.1ant))
  const runnerStyle = useAnimatedStyle(() => {
    const cyc = t.value;
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;
    const p = ease(cl((u - 0.14) / 0.54));
    const ant = ease(cl(u / 0.14)) * (1 - cl((u - 0.14) / 0.1));
    const xg = 60 - 120 * p;
    const a = sg * xg;
    const b = sg * 60;
    const r = (26 + 14 * p) * (1 - 0.1 * ant);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      backgroundColor: half ? WHITE : RED,
      left: lo - r,
      top: -r,
      width: hi - lo + 2 * r,
      height: 2 * r,
      borderRadius: r,
    };
  });

  // новая точка цвета базы рождается на противоположном краю
  const dotStyle = useAnimatedStyle(() => {
    const cyc = t.value;
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;
    const pr = 26 * easeBack(cl((u - 0.58) / 0.2));
    if (pr <= 0.5) return { opacity: 0 };
    return {
      opacity: 1,
      backgroundColor: half ? RED : WHITE,
      left: -sg * 60 - pr,
      top: -pr,
      width: 2 * pr,
      height: 2 * pr,
      borderRadius: pr,
    };
  });

  return (
    <View
      pointerEvents="none"
      style={[{ width: BASE_W * size, height: BASE_H * size, overflow: "visible" }, style]}
    >
      <View
        style={{
          position: "absolute",
          left: (BASE_W / 2) * (size - 1),
          top: (BASE_H / 2) * (size - 1),
          width: BASE_W,
          height: BASE_H,
          transform: [{ scale: size }],
        }}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              left: BASE_W / 2,
              top: BASE_H / 2,
              width: 0,
              height: 0,
            },
            groupStyle,
          ]}
        >
          <Animated.View style={[{ position: "absolute" }, baseStyle]} />
          <Animated.View style={[{ position: "absolute" }, runnerStyle]} />
          <Animated.View style={[{ position: "absolute" }, dotStyle]} />
        </Animated.View>
      </View>
    </View>
  );
}
