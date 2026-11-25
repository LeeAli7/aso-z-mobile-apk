import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { classifyError } from "../core/errors";
import { fonts } from "../theme/tokens";

/**
 * Баннер ошибки — тревога.
 * Выезжает сверху на всю ширину, сразу под строкой выбора модели: красное
 * поле, белый текст. Заголовок крупно, подробность ниже, крестик справа.
 * Внизу белая полоса таймаута — досвистела, баннер сам уезжает вверх.
 */

type Payload = { title: string; detail: string; code: string; id: number };

const DUR = 5200;
const RED = "#D62A1F";
const RED_DEEP = "#B72219";

let feed: ((p: Payload) => void) | null = null;
let seq = 0;

/** Показать тревогу. Можно звать откуда угодно. */
export function showErrorBanner(raw: unknown) {
  const info = classifyError(String(raw ?? ""));
  feed?.({
    title: info.title,
    detail: (info.detail || "").trim(),
    code: (info.code || "").trim(),
    id: ++seq,
  });
}

export function ErrorBannerHost() {
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<Payload | null>(null);
  const slide = useRef(new Animated.Value(0)).current; // 0 — скрыт, 1 — на экране
  const bar = useRef(new Animated.Value(1)).current;
  const timer = useRef<any>(null);
  const [h, setH] = useState(140);

  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    Animated.timing(slide, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setP(null);
    });
  }, [slide]);

  useEffect(() => {
    feed = (n) => {
      if (timer.current) clearTimeout(timer.current);
      setP(n);
      bar.setValue(1);
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      Animated.timing(bar, {
        toValue: 0,
        duration: DUR,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(hide, DUR);
    };
    return () => {
      feed = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slide, bar, hide]);

  if (!p) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 50 }]}>
      <Animated.View
        onLayout={(e) => {
          const nh = Math.round(e.nativeEvent.layout.height);
          if (nh && Math.abs(nh - h) > 2) setH(nh);
        }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-(h + 40), 0] }) },
          ],
        }}
      >
        <View
          style={{
            backgroundColor: RED,
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
            overflow: "hidden",
            shadowColor: RED_DEEP,
            shadowOpacity: 0.5,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
            elevation: 20,
            paddingTop: insets.top + 4,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", paddingLeft: 16, paddingRight: 8, paddingTop: 8, minHeight: 54 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  lineHeight: 20,
                  fontWeight: "700",
                  letterSpacing: -0.3,
                }}
              >
                {p.title}
              </Text>
              {!!p.detail && (
                <Text numberOfLines={5} style={{ color: "rgba(255,255,255,0.84)", fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>
                  {p.detail}
                </Text>
              )}
              {!!p.code && (
                <Text
                  style={{
                    color: "rgba(255,255,255,0.62)",
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    letterSpacing: 0.5,
                    marginTop: 4,
                  }}
                >
                  {p.code}
                </Text>
              )}
            </View>
            <Pressable
              onPress={hide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.16)",
                marginTop: -2,
              })}
            >
              <AppIcon name="close" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={{ height: 2, backgroundColor: "rgba(255,255,255,0.22)", marginTop: 9 }}>
            <Animated.View
              style={{
                height: 2,
                backgroundColor: "#FFFFFF",
                opacity: 0.92,
                transformOrigin: "left",
                transform: [{ scaleX: bar }],
              }}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
