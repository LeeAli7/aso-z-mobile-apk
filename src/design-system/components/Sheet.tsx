/**
 * Sheet — универсальная модальная панель снизу.
 *
 * Сделана на react-native Modal (не @gorhom/bottom-sheet) — работает
 * одинаково надёжно на Android, iOS и web-экспорте, кнопки внизу
 * никогда не обрезаются, контент скроллится.
 *
 * V4:
 *  - Плавная анимация входа/выхода (Animated, easeOutCubic 280ms):
 *    панель выезжает снизу, backdrop проявляется; закрытие — плавный
 *    уход вниз, а не мгновенный распад Modal.
 *  - Хендл — НАСТОЯЩАЯ drag-зона: тянешь вниз → панель едет за пальцем,
 *    за порогом (90px или быстрый флик) закрывается, иначе упруго
 *    возвращается. Свайп работает только с хендла/заголовка, чтобы не
 *    конфликтовать со скроллом контента.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

  // Величина ухода панели вниз: 0 = открыто, DROP = закрыто (примерно на всю высоту).
  const DROP = 720;
  const drop = useRef(new Animated.Value(0)).current;

  // Modal живёт, пока идёт анимация закрытия (иначе visible=false рвёт её мгновенно).
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sh = Keyboard.addListener("keyboardDidShow", (e) => setKbH(e.endCoordinates.height));
    const sh2 = Keyboard.addListener("keyboardWillShow", (e) => setKbH(e.endCoordinates.height));
    const hd = Keyboard.addListener("keyboardDidHide", () => setKbH(0));
    const hd2 = Keyboard.addListener("keyboardWillHide", () => setKbH(0));
    return () => {
      sh.remove(); sh2.remove(); hd.remove(); hd2.remove();
    };
  }, []);

  /** Плавное закрытие: уезжаем вниз, только потом сообщаем родителю. */
  const animateClose = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    Animated.timing(drop, {
      toValue: DROP,
      duration: 260,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      leavingRef.current = false;
      setLeaving(false);
      onClose();
    });
  }, [drop, onClose]);

  /** Плавный вход: панель снизу — на место, backdrop проявляется. */
  useEffect(() => {
    if (visible) {
      leavingRef.current = false;
      setLeaving(false);
      drop.stopAnimation();
      drop.setValue(DROP);
      requestAnimationFrame(() => {
        Animated.timing(drop, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    } else if (!leavingRef.current) {
      drop.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── drag-зона: хендл + заголовок ──
  // Тянем ВНИЗ → панель следует за пальцем (translateY = dy). Отпустили:
  //  - далеко (>90px) или быстрый флик вниз → плавно закрыть
  //  - иначе → упруго вернуть на место
  const dragStartY = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6 && g.dy > 0,
      onPanResponderGrant: () => {
        dragStartY.current = 0;
        drop.stopAnimation();
      },
      onPanResponderMove: (_evt, g) => {
        const y = Math.max(0, g.dy);
        drop.setValue(y);
      },
      onPanResponderRelease: (_evt, g) => {
        const fast = g.vy > 0.6;
        if (g.dy > 90 || (fast && g.dy > 24)) {
          animateClose();
        } else {
          Animated.spring(drop, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 22,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(drop, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 22 }).start();
      },
    }),
  ).current;

  // auto: по контенту (не выше autoMaxPct)
  const auto = snapPoints[0] === "auto";
  const raw = snapPoints[0] ?? "60%";
  const n = parseFloat(raw);
  const heightPct = Number.isFinite(n) ? Math.min(95, Math.max(25, n)) : 60;

  const tint = theme.name === "dark" ? "dark" : "light";
  const glassBorder = theme.name === "dark" ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.6)";

  // backdrop: opacity 0→1 по мере подъёма панели
  const backdropOpacity = drop.interpolate({
    inputRange: [0, DROP],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Modal
      visible={visible || leaving}
      transparent
      animationType="none"
      onRequestClose={animateClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* backdrop (анимированный) — тап закрывает */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim, opacity: backdropOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} accessibilityLabel="Закрыть" />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          {/* стеклянная панель: примитивами (без BlurView — он на Android не обрезается скруглением) */}
          <Animated.View
            pointerEvents={visible ? "auto" : "none"}
            style={[
              styles.panel,
              {
                height: auto ? undefined : `${heightPct}%`,
                maxHeight: auto ? `${autoMaxPct}%` : undefined,
                marginBottom: Platform.OS === "android" ? kbH : 0,
                backgroundColor: theme.name === "dark" ? "rgba(24,24,30,.82)" : "rgba(250,250,252,.88)",
                borderTopLeftRadius: radii.xl,
                borderTopRightRadius: radii.xl,
                borderWidth: 1,
                borderBottomWidth: 0,
                borderColor: glassBorder,
                paddingBottom: insets.bottom + 8,
                transform: [{ translateY: drop }],
                shadowColor: "#000",
                shadowOpacity: theme.name === "dark" ? 0.6 : 0.25,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: -8 },
                elevation: 20,
              },
            ]}
          >
            {/* drag-зона: хендл + заголовок — тянется вниз для закрытия */}
            <View {...pan.panHandlers}>
              {/* handle — широкая зона (тач-таргет ≥44), сам хендл — тонкая полоса */}
              <View style={styles.handleArea}>
                <View style={[styles.handle, { backgroundColor: theme.surface2 }]} />
              </View>

              {title ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                  <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>{title}</Text>
                </View>
              ) : null}
            </View>

            {/* тонкий световой блик по верхней грани (iOS glass) */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0.5, left: 0.5, right: 0.5,
                height: 1,
                backgroundColor: theme.name === "dark" ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.95)",
                opacity: 0.7,
              }}
            />

            {/* контент — скроллится, свайп закрытия НЕ вмешивается (он на хендле) */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
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
  handleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
    // drag-зона широкая, чтобы ловить палец; тач-таргет по высоте — норма
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});

export { StyleSheet };