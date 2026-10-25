import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

/**
 * «AI thought burst» — перенос третьего лоадера из эталона pill-loaders.html.
 * Цикл T = 2.8 с.
 *
 * Таймлайн:
 *   0.00–0.55 зарядка: красная труба растёт -60 → +60, дрожь и пульс растут
 *   0.55–0.62 сжатие пружины (sx 1→0.86, sy 1→1.16)
 *   0.62–0.74 вспышка: белое кольцо + белый круг
 *   0.62–0.80 разлёт 26 частиц
 *   0.80–0.94 сбор частиц с закруткой
 *   0.94–1.00 частицы гаснут, капсула выпрыгивает (easeOutBack)
 *
 * Красная зарядка живёт внутри белой капсулы (overflow:hidden) — по контуру
 * нет светлой кромки, наружу ничего не вылезает.
 */

const BASE_W = 380;
const BASE_H = 260;
const CAP_W = 200;
const CAP_H = 80;
const CAP_R = 40;
const T = 2.8;

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

type Part = {
  x0: number;
  a: number;
  D: number;
  r: number;
  red: boolean;
  qx: number;
  qy: number;
  sw: number;
};

/** Тот же детерминированный ГПСЧ, что в эталоне: seed 7, 26 частиц, 2/3 красных. */
function buildParticles(): Part[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const out: Part[] = [];
  for (let i = 0; i < 26; i++) {
    out.push({
      x0: -90 + 180 * rnd(),
      a: rnd() * 6.2832,
      D: 70 + 90 * rnd(),
      r: 4 + 5 * rnd(),
      red: i % 3 !== 0,
      qx: -85 + 170 * rnd(),
      qy: -28 + 56 * rnd(),
      sw: (rnd() - 0.5) * 60,
    });
  }
  return out;
}

const Particle = React.memo(function Particle({
  o,
  time,
}: {
  o: Part;
  time: SharedValue<number>;
}) {
  const st = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    if (u < 0.62 || u >= 0.98) {
      return { opacity: 0, left: 0, top: 0, width: 0, height: 0, borderRadius: 0 };
    }
    const w = cl((u - 0.62) / 0.18);
    const e = 1 - Math.pow(1 - w, 3);
    const bx = o.x0 + Math.cos(o.a) * o.D * e;
    const by = Math.sin(o.a) * o.D * e * 0.8;
    let x = bx;
    let y = by;
    let r = o.r;
    if (u >= 0.8) {
      const g = ease(cl((u - 0.8) / 0.14));
      const dx = o.qx - bx;
      const dy = o.qy - by;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      x = bx + dx * g + (-dy / len) * Math.sin(Math.PI * g) * o.sw;
      y = by + dy * g + (dx / len) * Math.sin(Math.PI * g) * o.sw;
      r = o.r * (1 - 0.3 * g);
    }
    if (u >= 0.94) r = r * (1 - cl((u - 0.94) / 0.05));
    const rr = Math.max(0, r);
    return {
      opacity: 1,
      left: x - rr,
      top: y - rr,
      width: rr * 2,
      height: rr * 2,
      borderRadius: rr,
    };
  });

  return (
    <Animated.View
      style={[
        { position: "absolute", backgroundColor: o.red ? RED : WHITE },
        st,
      ]}
    />
  );
});

type Props = { size?: number; onBurst?: () => void };

export function PillBurstLoader({ size = 1, onBurst }: Props) {
  const time = useSharedValue(0);
  const fired = useSharedValue(0);
  const parts = useMemo(buildParticles, []);

  useFrameCallback((f) => {
    const dt = Math.min(0.033, (f.timeSincePreviousFrame ?? 16.7) / 1000);
    time.value = time.value + dt;
  }, true);

  useAnimatedReaction(
    () => {
      const u = (time.value % T) / T;
      return u >= 0.62 && u < 0.68 ? 1 : 0;
    },
    (now, prev) => {
      if (now === 1 && prev !== 1 && onBurst) {
        runOnJS(onBurst)();
      }
    },
  );

  const group = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    const c = cl(u / 0.55);
    let p = Math.pow(c, 2.2);
    if (u > 0.55) p = 1;
    const sh = u < 0.62 ? 5 * p * p : 0;
    const ang = 20 + 3 * Math.sin(time.value * 3);
    return {
      transform: [
        {
          translateX:
            sh * Math.sin(time.value * 53) + 8 * Math.sin(time.value * 2.2),
        },
        { translateY: sh * Math.sin(time.value * 61 + 1) },
        { rotate: `${ang}deg` },
      ],
    };
  });

  const capsule = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    if (u >= 0.62 && u < 0.94) {
      return { opacity: 0, transform: [{ scaleX: 1 }, { scaleY: 1 }] };
    }
    let sx = 1;
    let sy = 1;
    let al = 1;
    if (u >= 0.55 && u < 0.62) {
      const q = ease(cl((u - 0.55) / 0.07));
      sx = 1 - 0.14 * q;
      sy = 1 + 0.16 * q;
    }
    if (u >= 0.94) {
      const b = back(cl((u - 0.94) / 0.06));
      sx = 0.7 + 0.3 * b;
      sy = sx;
      al = cl((u - 0.94) / 0.03);
    }
    return {
      opacity: al,
      transform: [{ scaleX: sx }, { scaleY: sy }],
    };
  });

  const charge = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    const c = cl(u / 0.55);
    let p = Math.pow(c, 2.2);
    if (u > 0.55) p = 1;
    const pp = u >= 0.94 ? 0 : p;
    const pulse =
      2 * Math.sin(time.value * (12 + 30 * pp)) * (0.3 + pp);
    const r = 26 + 14 * pp + (u < 0.55 ? pulse : 0);
    const rr = Math.max(0, r);
    return {
      opacity: 1,
      left: CAP_W / 2 - 60 - rr,
      top: CAP_H / 2 - rr,
      width: 120 * pp + 2 * rr,
      height: 2 * rr,
      borderRadius: rr,
    };
  });

  const ring = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    if (u < 0.62 || u >= 0.74) return { opacity: 0, left: 0, top: 0, width: 0, height: 0 };
    const f = cl((u - 0.62) / 0.12);
    const R = 40 + 140 * f;
    const d = R * 2;
    return {
      opacity: 1 - f,
      left: -R,
      top: -R,
      width: d,
      height: d,
      borderRadius: R,
      borderWidth: 6 * (1 - f) + 1,
    };
  });

  const core = useAnimatedStyle(() => {
    const u = (time.value % T) / T;
    if (u < 0.62 || u >= 0.74) return { opacity: 0 };
    const f = cl((u - 0.62) / 0.12);
    return { opacity: 0.9 * (1 - cl(f * 3)) };
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
                backgroundColor: WHITE,
              },
              capsule,
            ]}
          >
            <Animated.View
              style={[
                { position: "absolute", backgroundColor: RED },
                charge,
              ]}
            />
          </Animated.View>

          {parts.map((o, i) => (
            <Particle key={i} o={o} time={time} />
          ))}

          <Animated.View
            style={[
              {
                position: "absolute",
                borderColor: WHITE,
              },
              ring,
            ]}
          />
          <Animated.View
            style={[
              {
                position: "absolute",
                left: -60,
                top: -60,
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: WHITE,
              },
              core,
            ]}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
});
