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
      {/* мягкое свечение: синее (KMBlue), фиолетовое (агент), оранжевое */}
      <View
        style={[
          styles.blob,
          styles.blobA,
          { backgroundColor: dark ? "rgba(26,136,255,.30)" : "rgba(23,131,255,.34)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobB,
          { backgroundColor: dark ? "rgba(161,107,255,.20)" : "rgba(152,95,251,.26)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobC,
          { backgroundColor: dark ? "rgba(255,149,0,.14)" : "rgba(255,149,0,.20)" },
        ]}
      />
      <View
        style={[
          styles.blob,
          styles.blobD,
          { backgroundColor: dark ? "rgba(22,196,86,.10)" : "rgba(22,196,86,.16)" },
        ]}
      />
      {/* свечение в углу сцены, на котором особенно виден блюр кнопок */}
      <View
        style={[
          styles.sheen,
          {
            backgroundColor: dark ? "rgba(77,166,255,.13)" : "rgba(6,102,255,.16)",
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
    width: 420,
    height: 420,
    borderRadius: 999,
    opacity: 0.55,
  },
  blobA: {
    top: -140,
    left: -120,
  },
  blobB: {
    top: 120,
    right: -160,
    width: 460,
    height: 460,
  },
  blobC: {
    bottom: 40,
    left: -150,
    width: 380,
    height: 380,
    opacity: 0.4,
  },
  blobD: {
    bottom: -120,
    right: -80,
    width: 360,
    height: 360,
    opacity: 0.35,
  },
  sheen: {
    position: "absolute",
    width: 600,
    height: 340,
    borderRadius: 999,
    top: -140,
    right: -160,
    opacity: 0.5,
    transform: [{ rotate: "-12deg" }],
  },
});