/**
 * Sheet — универсальная модальная панель снизу.
 *
 * Сделана на react-native Modal (не @gorhom/bottom-sheet) — работает
 * одинаково надёжно на Android, iOS и web-экспорте, кнопки внизу
 * никогда не обрезаются, контент скроллится.
 *
 * Плюсы Modal-подхода: нет зависимости от жестов/Reanimated,
 * рендерится поверх всего, можно закрыть по backdrop.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../../store/AppStore";
import { IconButton } from "./IconButton";
import { radii } from "../tokens";

export function Sheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = ["60%"],
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  snapPoints?: string[];
}) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [offsetY, setOffsetY] = useState(0);
  const offsetRef = useRef(0);
  const startYRef = useRef(0);

  // числовая высота панели из первого snapPoint (напр. "60%" -> 60)
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

        {/* панель */}
        <View
          style={[
            styles.panel,
            {
              height: `${heightPct()}%`,
              backgroundColor: theme.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingBottom: insets.bottom + 8,
              transform: [{ translateY: offsetY }],
            },
          ]}
          {...pan.panHandlers}
        >
          {/* handle */}
          <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 2 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.surface2 }} />
          </View>

          {/* header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
            <IconButton name="close" onPress={onClose} size={18} haptic={false} accessibilityLabel="Закрыть" />
          </View>

          {/* контент — скроллится, кнопки снизу всегда доступны */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
          >
            {children}
          </ScrollView>
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
