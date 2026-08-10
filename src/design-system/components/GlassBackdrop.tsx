/**
 * GlassBackdrop — фоновое свечение (glow-blobs), которое лежит ПОД всем стеклом.
 *
 * Глэссморфизм невидим, если под стеклом пустой чёрный фон — blur'у нечего
 * размывать. Чтобы стекло в самом деле читалось как матовое, под UI
 * живут размытые цветные пятна (синий KMBlue, фиолетовый, оранжевый),
 * и стеклянные панели/кнопки над ними дают честный frosted-эффект.
 *
 * Нарисовано примитивами (View + borderRadius + размытие через opacity),
 * без PNG-оверлеев — резольвится на всех платформах.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useApp } from "../../store/AppStore";

export function GlassBackdrop({ fixed = false }: { fixed?: boolean }) {
  const { theme } = useApp();
  const dark = theme.name === "dark";
  // absolute достаточно (родитель flex:1, перекрывает весь экран); fixed лучше
  // держит фон на web при скролле, но RN-типы не знают "fixed" — приводим к any.
  const pos = (fixed ? { position: "fixed" } : { position: "absolute" }) as any;
  return (
    <View pointerEvents="none" style={[pos, styles.root, { backgroundColor: theme.bg }]}>
      {/* мягкое свечение: синее (KMBlue), фиолетовое (агент), оранжевое — усилено,
          чтобы стеклу было что преломлять (фон остаётся чёрным) */}
      <View
        style={[
          styles.blob,
          styles.blobA,
          { backgroundColor: dark ? "rgba(26,136,255,.42)" : "rgba(23,131,255,.44)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobB,
          { backgroundColor: dark ? "rgba(161,107,255,.30)" : "rgba(152,95,251,.34)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobC,
          { backgroundColor: dark ? "rgba(255,149,0,.22)" : "rgba(255,149,0,.26)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobD,
          { backgroundColor: dark ? "rgba(22,196,86,.16)" : "rgba(22,196,86,.20)" },
        ]}
      />
      {/* свечение в углу сцены, на котором особенно виден блюр кнопок */}
      <View
        style={[
          styles.sheen,
          {
            backgroundColor: dark ? "rgba(77,166,255,.20)" : "rgba(6,102,255,.22)",
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
  blob: {
    position: "absolute",
    width: 520,
    height: 520,
    borderRadius: 999,
    opacity: 0.7,
  },
  blobA: {
    top: -160,
    left: -140,
  },
  blobB: {
    top: 100,
    right: -180,
    width: 560,
    height: 560,
  },
  blobC: {
    bottom: 20,
    left: -170,
    width: 480,
    height: 480,
    opacity: 0.55,
  },
  blobD: {
    bottom: -140,
    right: -100,
    width: 440,
    height: 440,
    opacity: 0.5,
  },
  sheen: {
    position: "absolute",
    width: 700,
    height: 400,
    borderRadius: 999,
    top: -160,
    right: -180,
    opacity: 0.6,
    transform: [{ rotate: "-12deg" }],
  },
});