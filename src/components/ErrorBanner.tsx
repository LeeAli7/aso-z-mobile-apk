import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { classifyError, type ErrorInfo } from "../core/errors";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";

/**
 * Баннер ошибки — тревога.
 * Выезжает сверху на всю ширину: красное поле, белый текст, крестик справа,
 * внизу белая полоса таймаута. Появляется и уходит с анимацией; если ошибка
 * пришла, пока баннер на экране, он не прыгает заново — меняет текст на месте.
 */

type Payload = { info: ErrorInfo; id: number };

const DUR = 5200;
const IN_MS = 340;
const OUT_MS = 240;
const RED = "#D62A1F";
const RED_DEEP = "#B72219";

let feed: ((p: Payload) => void) | null = null;
let seq = 0;

/** Показать тревогу. Можно звать откуда угодно. */
export function showErrorBanner(raw: unknown) {
  feed?.({ info: classifyError(String(raw ?? "")), id: ++seq });
}

export function ErrorBannerHost() {
  const insets = useSafeAreaInsets();
  const { t } = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const slide = useRef(new Animated.Value(0)).current; // 0 — скрыт, 1 — на экране
  const bar = useRef(new Animated.Value(1)).current;
  const timer = useRef<any>(null);
  const visible = useRef(false);
  const [h, setH] = useState(150);

  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    Animated.timing(slide, {
      toValue: 0,
      duration: OUT_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        visible.current = false;
        setP(null);
      }
    });
  }, [slide]);

  useEffect(() => {
    feed = (n) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const already = visible.current;
      setP(n);
      bar.setValue(1);

      if (already) {
        // уже на экране — просто обновляем содержимое и перезапускаем таймер
        Animated.timing(bar, {
          toValue: 0,
          duration: DUR,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
        timer.current = setTimeout(hide, DUR);
        return;
      }

      visible.current = true;
      slide.setValue(0);
      // один кадр, чтобы вьюха встала в разметку: иначе первый кадр — рывок
      requestAnimationFrame(() => {
        Animated.timing(slide, {
          toValue: 1,
          duration: IN_MS,
          easing: Easing.bezier(0.16, 0.84, 0.24, 1),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) return;
          Animated.timing(bar, {
            toValue: 0,
            duration: DUR,
            easing: Easing.linear,
            useNativeDriver: true,
          }).start();
          timer.current = setTimeout(hide, DUR);
        });
      });
    };
    return () => {
      feed = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slide, bar, hide]);

  if (!p) return null;

  const title = t(p.info.titleKey);
  const detail =
    p.info.detailKey === "err_nodetail" && p.info.detail
      ? p.info.detail
      : t(p.info.detailKey, p.info.params);

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
          opacity: slide.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [-(h + 40), 0],
              }),
            },
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
                {title}
              </Text>
              {!!detail && (
                <Text numberOfLines={5} style={{ color: "rgba(255,255,255,0.84)", fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>
                  {detail}
                </Text>
              )}
              {!!p.info.code && (
                <Text
                  style={{
                    color: "rgba(255,255,255,0.62)",
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    letterSpacing: 0.5,
                    marginTop: 4,
                  }}
                >
                  {p.info.code}
                </Text>
              )}
            </View>
            <Pressable
              onPress={hide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("close")}
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
