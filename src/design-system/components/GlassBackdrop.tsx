/**
 * GlassBackdrop — фон приложения в стиле КРОВЬ.
 *
 * Раньше здесь жили цветные blur-пятна (синее, фиолетовое, оранжевое,
 * зелёное) — они давали мутные полосы по краям и «радугу» на чёрном.
 * В системе КРОВЬ фон — просто чёрный. Никаких свечений и градиентов.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useApp } from "../../store/AppStore";

export function GlassBackdrop({ fixed = false }: { fixed?: boolean }) {
  const { theme } = useApp();
  const pos = (fixed ? { position: "fixed" } : { position: "absolute" }) as any;
  return <View pointerEvents="none" style={[pos, styles.root, { backgroundColor: theme.bg }]} />;
}

const styles = StyleSheet.create({
  root: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
