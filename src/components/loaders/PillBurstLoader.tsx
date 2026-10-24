/**
 * PillBurstLoader — «AI thought burst» 1:1 с референса pill-loaders.html (блок 3).
 *
 * Капсула заряжается красным (с дрожью), пружина сжимается, вспышка — и
 * иконка разлетается на 26 частиц, которые закручиваются и собираются
 * обратно, после чего капсула «выпрыгивает» заново.
 *
 * Таймлайн (u = 0..1 за цикл T):
 *   0.00–0.55 зарядка: красная труба растёт -60 → +60 (p = u^2.2), дрожь растёт
 *   0.55–0.62 сжатие пружины (sx 1→0.86, sy 1→1.16)
 *   0.62–0.74 вспышка: белое кольцо + белый круг
 *   0.62–0.80 разлёт частиц (easeOutCubic)
 *   0.80–0.94 сбор с закруткой в точки внутри капсулы
 *   0.94–1.00 частицы гаснут, капсула выпрыгивает (easeOutBack)
 *
 * Частицы детерминированы (seed = 7, ЛКГ), генерация один раз.
 */
import React, { useMemo } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  SharedValue,
} from "react-native-reanimated";

const RED = "#FF3B30";
const WHITE = "#FFFFFF";
const BASE_W = 380;
const BASE_H = 260;
const CYCLE = 2.8; // секунд на цикл
const BURST_AT = 0.62;

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

type Particle = {
  x0: number;
  a: number;
  D: number;
  r: number;
  red: boolean;
  qx: number;
  qy: number;
  sw: number;
};

function makeParticles(): Particle[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const out: Particle[] = [];
  for (let i = 0; i < 26; i++) {
    out.push({
      x0: -90 + 180 * rnd(),
      a: rnd() * Math.PI * 2,
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

type Props = {
  size?: number;
  /** множитель скорости, 1 = цикл 2.8 с */
  speed?: number;
  /** вызывается в момент вспышки (u = 0.62) каждого цикла */
  onBurst?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function PillBurstLoader({ size = 1, speed = 1, onBurst, style }: Props) {
  const T = CYCLE / (speed || 1);
  const t = useSharedValue(0);
  const particles = useMemo(makeParticles, []);

  useFrameCallback((info) => {
    "worklet";
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    let next = t.value + dt;
    if (next >= T) next -= T;
    t.value = next;
  }, true);

  // вспышка каждого цикла — наружу, без setState внутри кадра
  useAnimatedReaction(
    () => Math.floor(t.value / T) * 0 + (t.value / T >= BURST_AT ? 1 : 0),
    (pass, prev) => {
      "worklet";
      if (pass === 1 && prev === 0 && onBurst) {
        runOnJS(onBurst)();
      }
    },
  );

  // общая группа: дрожь/дрейф → наклон
  const groupStyle = useAnimatedStyle(() => {
    const time = t.value;
    const u = (time % T) / T;
    const c = cl(u / 0.55);
    const p = u > 0.55 ? 1 : Math.pow(c, 2.2);
    const sh = u < 0.62 ? 5 * p * p : 0;
    const ang = ((20 + 3 * Math.sin(time * 3)) * Math.PI) / 180;
    return {
      transform: [
        { translateX: sh * Math.sin(time * 53) + 8 * Math.sin(time * 2.2) },
        { translateY: sh * Math.sin(time * 61 + 1) },
        { rotate: `${ang}rad` },
      ],
    };
  });

  // капсула с зарядкой и «выпрыгиванием»
  const capsuleStyle = useAnimatedStyle(() => {
    const time = t.value;
    const u = (time % T) / T;
    const c = cl(u / 0.55);
    const p = u > 0.55 ? 1 : Math.pow(c, 2.2);
    if (u >= 0.62 && u < 0.94) {
      return { opacity: 0, width: 200, height: 80 };
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
      const b = easeBack(cl((u - 0.94) / 0.06));
      sx = 0.7 + 0.3 * b;
      sy = 0.7 + 0.3 * b;
      al = cl((u - 0.94) / 0.03);
    }
    return {
      opacity: al,
      transform: [{ scaleX: sx }, { scaleY: sy }],
    };
  });

  // красная «труба» внутри капсулы
  const chargeStyle = useAnimatedStyle(() => {
    const time = t.value;
    const u = (time % T) / T;
    const c = cl(u / 0.55);
    const p = u > 0.55 ? 1 : Math.pow(c, 2.2);
    if (u >= 0.62 && u < 0.94) return { opacity: 0 };
    const pp = u >= 0.94 ? 0 : p;
    if (pp <= 0.02) return { opacity: 0 };
    const pulse = 2 * Math.sin(time * (12 + 30 * pp)) * (0.3 + pp);
    const r = 26 + 14 * pp + (u < 0.55 ? pulse : 0);
    const a = -60;
    const b = -60 + 120 * pp;
    const w = b - a + 2 * r;
    return {
      opacity: 1,
      backgroundColor: RED,
      left: a - r,
      top: -r,
      width: w,
      height: 2 * r,
      borderRadius: r,
    };
  });

  // вспышка: кольцо + круг
  const flashRingStyle = useAnimatedStyle(() => {
    const u = (t.value % T) / T;
    if (u < 0.62 || u >= 0.74) return { opacity: 0 };
    const f = cl((u - 0.62) / 0.12);
    const rr = 40 + 140 * f;
    const lw = 6 * (1 - f) + 1;
    return {
      opacity: 1 - f,
      borderWidth: lw,
      borderColor: WHITE,
      backgroundColor: "transparent",
      left: -rr,
      top: -rr,
      width: 2 * rr,
      height: 2 * rr,
      borderRadius: rr,
    };
  });

  const flashCoreStyle = useAnimatedStyle(() => {
    const u = (t.value % T) / T;
    if (u < 0.62 || u >= 0.74) return { opacity: 0 };
    const f = cl((u - 0.62) / 0.12);
    return {
      opacity: 0.9 * (1 - cl(f * 3)),
      backgroundColor: WHITE,
      left: -60,
      top: -60,
      width: 120,
      height: 120,
      borderRadius: 60,
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
        <Animated.View style={[{ position: "absolute" }, capsuleStyle]}>
          <Animated.View
            style={[
              {
                position: "absolute",
                left: -100,
                top: -40,
                width: 200,
                height: 80,
                borderRadius: 40,
                backgroundColor: WHITE,
              },
            ]}
          />
          <Animated.View style={[{ position: "absolute" }, chargeStyle]} />
        </Animated.View>

        <Animated.View style={[{ position: "absolute" }, flashRingStyle]} />
        <Animated.View style={[{ position: "absolute" }, flashCoreStyle]} />

        {particles.map((p, i) => (
          <ParticleDot key={i} p={p} t={t} T={T} />
        ))}
      </Animated.View>
      </View>
    </View>
  );
}

function ParticleDot({
  p,
  t,
  T,
}: {
  p: Particle;
  t: SharedValue<number>;
  T: number;
}) {
  const s = useAnimatedStyle(() => {
    const u = (t.value % T) / T;
    if (u < 0.62 || u >= 0.98) return { opacity: 0 };
    const w = cl((u - 0.62) / 0.18);
    const e = 1 - Math.pow(1 - w, 3);
    const bx = p.x0 + Math.cos(p.a) * p.D * e;
    const by = Math.sin(p.a) * p.D * e * 0.8;
    let x = bx;
    let y = by;
    let r = p.r;
    if (u >= 0.8) {
      const g = ease(cl((u - 0.8) / 0.14));
      const dx = p.qx - bx;
      const dy = p.qy - by;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      x = bx + dx * g + (-dy / len) * Math.sin(Math.PI * g) * p.sw;
      y = by + dy * g + (dx / len) * Math.sin(Math.PI * g) * p.sw;
      r = p.r * (1 - 0.3 * g);
    }
    if (u >= 0.94) r = r * (1 - cl((u - 0.94) / 0.05));
    if (r <= 0.2) return { opacity: 0 };
    return {
      opacity: 1,
      backgroundColor: p.red ? RED : WHITE,
      left: x - r,
      top: y - r,
      width: 2 * r,
      height: 2 * r,
      borderRadius: r,
    };
  });
  return <Animated.View style={[{ position: "absolute" }, s]} />;
}
