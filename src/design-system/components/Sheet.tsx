/**
 * Sheet — универсальная модальная панель снизу.
 *
 * Сделана на react-native Modal (не @gorhom/bottom-sheet) — работает
 * одинаково надёжно на Android, iOS и web-экспорте, кнопки внизу
 * никогда не обрезаются, контент скроллится.
 *
 * Плюсы Modal-подхода: нет зависимости от жестов/Reanimated,
 * рендерится поверх всего, можно закрыть по backdrop.
 *
 * V3: панель — стекло (глэссморфизм, BlurView поверх scrim),
 * в стиле Kimi: молочное стекло, тонкая рамка, блик сверху.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../../store/AppStore";
import { radii } from "../tokens";

export function Sheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = ["60%"],
  autoMaxPct = 70,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: string[];
  /** В режиме auto — максимум высоты в % экрана (дальше скролл). По умолчанию 70. */
  autoMaxPct?: number;
}) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [offsetY, setOffsetY] = useState(0);
  const offsetRef = useRef(0);
  const startYRef = useRef(0);

  // числовая высота панели из первого snapPoint (напр. "60%" -> 60), "auto" — по контенту
  const auto = snapPoints[0] === "auto";
  const heightPct = useCallback(() => {
    const raw = snapPoints[0] ?? "60%";
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.min(95, Math.max(25, n)) : 60;
  }, [snapPoints]);

  // свайп вниз для закрытия (простой PanResponder)
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 10 && g.dy > 0,
      onPanResponderMove: (_evt, g) => {
        offsetRef.current = Math.max(0, g.dy);
        setOffsetY(offsetRef.current);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > 90) onClose();
        else {
          offsetRef.current = 0;
          setOffsetY(0);
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (!visible) {
      offsetRef.current = 0;
      setOffsetY(0);
    }
  }, [visible]);

  const tint = theme.name === "dark" ? "dark" : "light";
  const glassBorder = theme.name === "dark" ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.6)";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, { backgroundColor: theme.scrim }]}>
        {/* backdrop — тап закрывает */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть" />

        {/* стеклянная панель (имитация: полупрозрачный фон + рамка + блик) */}
        <View
          style={[
            styles.panel,
            {
              height: auto ? undefined : `${heightPct()}%`,
              maxHeight: auto ? `${autoMaxPct}%` : undefined,
              backgroundColor: theme.name === "dark" ? "rgba(22,22,26,.60)" : "rgba(250,250,252,.72)",
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: glassBorder,
              paddingBottom: insets.bottom + 8,
              transform: [{ translateY: offsetY }],
              shadowColor: "#000",
              shadowOpacity: theme.name === "dark" ? 0.6 : 0.25,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -8 },
              elevation: 20,
            },
          ]}
          {...pan.panHandlers}
        >
          {/* блюр-слой: размывает чат/фон за окошком; pointerEvents="none" — не перехватывает тачи */}
          <BlurView
            intensity={30}
            tint={theme.name === "dark" ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* handle — симметрично: равные отступы сверху и до контента */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 10 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.surface2 }} />
          </View>

          {/* header — только заголовок; закрытие свайпом вниз или тапом по фону */}
          {title ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>{title}</Text>
            </View>
          ) : null}

          {/* контент — в режиме auto окно по контенту, но не выше autoMaxPct% (скролл при переполнении) */}
          {auto ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 20 }}
            >
              {children}
            </ScrollView>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
            >
              {children}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  panel: {
    width: "100%",
    overflow: "hidden",
  },
});

export { StyleSheet };
