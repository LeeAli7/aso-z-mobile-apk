import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

/**
 * «Role swap» — перенос первого лоадера из эталона pill-loaders.html.
 * Половина цикла HALF = 1.5 с, полный цикл 3 с.
 *
 * Математика 1:1 с эталоном:
 *   p   = ease(cl((u-.14)/.54))      — прогресс бега
 *   xg  = 60 - 120p                  — голова бегуна
 *   ant = ease(cl(u/.14))*(1-cl((u-.14)/.1)) — замах
 *   pop = cl((u-.68)/.25)            — пульс при рождении точки
 *   sc  = 1 + .09 sin(π pop)(1-.4 pop)
 *   transform: translate(-sg*16 sin πp, -10 sin πp), rotate(20 - sg*8 sin πp),
 *              scaleX sc(1-.08 ant), scaleY sc(1+.1 ant)
 *   база  — капсула ±60, r=40
 *   бегун — труба sg*xg .. sg*60, r=(26+14p)(1-.1 ant)
 *   точка — r = 26 back(cl((u-.58)/.2)) на краю -sg*60
 *
 * Бегун и точка живут внутри капсулы с overflow:hidden — светлой кромки
 * по контуру не возникает, наружу ничего не вылезает.
 */

const BASE_W = 380;
const BASE_H = 260;
const CAP_W = 200;
const CAP_H = 80;
const CAP_R = 40;
const HALF = 1.5;

const RED = "#FF3B30";
const WHITE = "#FFFFFF";

const cl = (x: number) => {
  "worklet";
  return Math.max(0, Math.min(1, x));
};
const ease = (t: number) => {
  "worklet";
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const back = (t: number) => {
  "worklet";
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

type Props = { size?: number };

export function PillSwapLoader({ size = 1 }: Props) {
  const time = useSharedValue(0);

  useFrameCallback((f) => {
    const dt = Math.min(0.033, (f.timeSincePreviousFrame ?? 16.7) / 1000);
    time.value = time.value + dt;
  }, true);

  const group = useAnimatedStyle(() => {
    const cyc = time.value % (2 * HALF);
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;

    const p = ease(cl((u - 0.14) / 0.54));
    const ant = ease(cl(u / 0.14)) * (1 - cl((u - 0.14) / 0.1));
    const pop = cl((u - 0.68) / 0.25);
    const sc = 1 + 0.09 * Math.sin(Math.PI * pop) * (1 - pop * 0.4);
    const ang = 20 - sg * 8 * Math.sin(Math.PI * p);

    return {
      transform: [
        { translateX: -sg * 16 * Math.sin(Math.PI * p) },
        { translateY: -10 * Math.sin(Math.PI * p) },
        { rotate: `${ang}deg` },
        { scaleX: sc * (1 - 0.08 * ant) },
        { scaleY: sc * (1 + 0.1 * ant) },
      ],
    };
  });

  const capsule = useAnimatedStyle(() => {
    const cyc = time.value % (2 * HALF);
    const half = cyc < HALF ? 0 : 1;
    return { backgroundColor: half ? RED : WHITE };
  });

  const runner = useAnimatedStyle(() => {
    const cyc = time.value % (2 * HALF);
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;

    const p = ease(cl((u - 0.14) / 0.54));
    const ant = ease(cl(u / 0.14)) * (1 - cl((u - 0.14) / 0.1));
    const r = (26 + 14 * p) * (1 - 0.1 * ant);

    const head = sg * (60 - 120 * p);
    const tail = sg * 60;
    const lo = Math.min(head, tail);

    return {
      left: CAP_W / 2 + lo - r,
      top: CAP_H / 2 - r,
      width: Math.abs(head - tail) + 2 * r,
      height: 2 * r,
      borderRadius: r,
      backgroundColor: half ? WHITE : RED,
    };
  });

  const dot = useAnimatedStyle(() => {
    const cyc = time.value % (2 * HALF);
    const half = cyc < HALF ? 0 : 1;
    const u = (cyc % HALF) / HALF;
    const sg = half ? -1 : 1;

    const pr = 26 * back(cl((u - 0.58) / 0.2));
    const on = pr > 0.5 ? 1 : 0;

    return {
      opacity: on,
      left: CAP_W / 2 - sg * 60 - pr,
      top: CAP_H / 2 - pr,
      width: 2 * pr,
      height: 2 * pr,
      borderRadius: pr,
      backgroundColor: half ? RED : WHITE,
    };
  });

  return (
    <View
      pointerEvents="none"
      style={[s.box, { width: BASE_W * size, height: BASE_H * size }]}
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
            group,
          ]}
        >
          <Animated.View
            style={[
              {
                position: "absolute",
                left: -CAP_W / 2,
                top: -CAP_H / 2,
                width: CAP_W,
                height: CAP_H,
                borderRadius: CAP_R,
                overflow: "hidden",
              },
              capsule,
            ]}
          >
            <Animated.View style={[{ position: "absolute" }, runner]} />
            <Animated.View style={[{ position: "absolute" }, dot]} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
});
