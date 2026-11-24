import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "../design-system/components/AppIcon";
import { StepSlider } from "./StepSlider";
import { CTX_LABELS, CTX_STEPS, REASONING_LABELS, type ModelPrefs } from "../core/modelPrefs";
import { fonts, type Theme } from "../theme/tokens";

type Model = {
  modelName: string;
  displayName?: string;
  providerName?: string;
  tier?: string;
};

const W = 300;
const HEAD = 44;
const ROW = 58;
const FOOT = 44;
const PAD = 6;
const LIST_MAX = 232;
const PICKED = "#2C2C31";

/**
 * Окно выбора модели — по макету v2 (model-picker-spec.md), ДВА окна.
 *
 * 1. Список: поверхность растёт из самой кнопки (её прямоугольник приходит в
 *    anchor, кнопка на время скрыта) — 118×40 → 300×N, r 26 → 20, верхний край
 *    неподвижен. Шапка 44 закрывает, строки 58, разделитель, две строки футера.
 * 2. Параметр: отдельная карточка под списком (right 12, +8), r 20, фон #202024.
 *    Одна карточка на оба параметра: тап по строке футера меняет её содержимое.
 */
export function ModelPickerPopover({
  open,
  models,
  current,
  onSelect,
  onClose,
  theme,
  anchor,
  screenW,
  prefs,
  onPrefs,
  onAdd,
}: {
  open: boolean;
  models: Model[];
  current?: string;
  onSelect: (m: Model) => void;
  onClose: () => void;
  theme: Theme;
  anchor: { x: number; y: number; w: number; h: number };
  screenW: number;
  prefs: ModelPrefs;
  onPrefs: (p: ModelPrefs) => void;
  onAdd: () => void;
}) {
  const [mounted, setMounted] = useState(open);
  const [param, setParam] = useState<"reason" | "ctx">("reason");
  const p = useSharedValue(0);

  const rows = models.length;
  const listH = rows > 4 ? LIST_MAX : Math.max(1, rows) * ROW;
  const winH = HEAD + PAD * 2 + listH + 1 + PAD * 2 + FOOT * 3;

  useEffect(() => {
    if (open) {
      setMounted(true);
      p.value = withTiming(1, { duration: 240, easing: REasing.out(REasing.cubic) });
      return;
    }
    p.value = withTiming(0, { duration: 180, easing: REasing.in(REasing.cubic) });
    const id = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(id);
  }, [open, p]);

  const win = useAnimatedStyle(() => ({
    width: anchor.w + (W - anchor.w) * p.value,
    height: anchor.h + (winH - anchor.h) * p.value,
    borderRadius: 26 + (20 - 26) * p.value,
  }));
  const body = useAnimatedStyle(() => ({ opacity: p.value * p.value }));

  if (!mounted) return null;

  const cur = models.find((m) => m.modelName === current);
  const ctxIdx = Math.max(0, CTX_STEPS.findIndex((c) => c >= prefs.ctx));
  const right = screenW - (anchor.x + anchor.w);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 30 }]} pointerEvents={open ? "box-none" : "none"}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть выбор модели" />

      {/* ── окно 1: список ── */}
      <Reanimated.View
        style={[
          { position: "absolute", top: anchor.y, right, backgroundColor: theme.surface2, overflow: "hidden" },
          win,
        ]}
      >
        <Reanimated.View style={[{ flex: 1 }, body]}>
          <Pressable
            onPress={onClose}
            style={{ height: HEAD, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 }}
            accessibilityLabel="Закрыть выбор модели"
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: fonts.sansDemi }}>
              {cur?.displayName ?? "Модель"}
            </Text>
            <AppIcon name="chevron-down" size={14} color={theme.dim} />
          </Pressable>

          <View style={{ paddingHorizontal: PAD }}>
            <ScrollView style={{ height: listH }} showsVerticalScrollIndicator={false}>
              {models.length === 0 ? (
                <Text style={{ color: theme.dim, fontSize: 13, paddingVertical: 16, paddingHorizontal: 8 }}>
                  Модели не подключены
                </Text>
              ) : (
                models.map((m) => {
                  const on = m.modelName === current;
                  const meta = m.providerName ?? m.tier ?? "";
                  return (
                    <Pressable
                      key={m.modelName}
                      onPress={() => onSelect(m)}
                      style={({ pressed }) => ({
                        height: ROW,
                        borderRadius: 14,
                        paddingHorizontal: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        backgroundColor: on || pressed ? PICKED : "transparent",
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={m.displayName ?? m.modelName}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={{ color: theme.text, fontSize: 15.5, fontFamily: fonts.sansMedium, letterSpacing: -0.1 }}
                        >
                          {m.displayName ?? m.modelName}
                        </Text>
                        {meta ? (
                          <Text
                            numberOfLines={1}
                            style={{ color: theme.mute, fontSize: 11, marginTop: 2, fontFamily: fonts.mono }}
                          >
                            {meta}
                          </Text>
                        ) : null}
                      </View>
                      {on ? <AppIcon name="check" size={18} color={theme.text} /> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>

          <View style={{ height: 1, backgroundColor: PICKED, marginHorizontal: PAD }} />

          <View style={{ padding: PAD }}>
            {([
              ["reason", "Рассуждение", REASONING_LABELS[prefs.reasoning]],
              ["ctx", "Контекст", CTX_LABELS[ctxIdx]],
            ] as const).map(([key, label, val]) => {
              const on = param === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setParam(key)}
                  style={({ pressed }) => ({
                    height: FOOT,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: on || pressed ? PICKED : "transparent",
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <Text style={{ flex: 1, color: on ? theme.text : theme.dim, fontSize: 14 }}>{label}</Text>
                  <Text style={{ color: theme.text, fontSize: 14 }}>{val}</Text>
                  <AppIcon name={on ? "chevron-down" : "chevron-right"} size={12} color={theme.mute} />
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => {
                onClose();
                onAdd();
              }}
              style={({ pressed }) => ({
                height: FOOT,
                borderRadius: 12,
                paddingHorizontal: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: pressed ? PICKED : "transparent",
              })}
              accessibilityRole="button"
              accessibilityLabel="Добавить провайдера и модель"
            >
              <AppIcon name="plus" size={14} color={theme.dim} />
              <Text style={{ color: theme.dim, fontSize: 14 }}>Свой провайдер и модель</Text>
            </Pressable>
          </View>
        </Reanimated.View>
      </Reanimated.View>

      {/* ── окно 2: параметр, всегда на месте ── */}
      <Reanimated.View
        style={[{
          opacity: p.value,
          transform: [{ translateY: (1 - p.value) * 6 }],
        }, {
          position: "absolute",
          right,
          top: anchor.y + winH + 8,
          width: W,
          borderRadius: 20,
          backgroundColor: theme.surface2,
          paddingTop: 12,
          paddingBottom: 12,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.45,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        }]}
      >
        {param === "reason" ? (
          <View style={{ paddingHorizontal: 14 }}>
            <StepSlider
              caption="Рассуждение"
              steps={[...REASONING_LABELS]}
              value={prefs.reasoning}
              onCommit={(i) => onPrefs({ ...prefs, reasoning: i as ModelPrefs["reasoning"] })}
              theme={theme}
              note="Больше шагов — дольше ответ"
            />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 14 }}>
            <StepSlider
              caption="Контекст"
              steps={[...CTX_LABELS]}
              value={ctxIdx}
              onCommit={(i) => onPrefs({ ...prefs, ctx: CTX_STEPS[i] })}
              theme={theme}
              labelsMode="ends"
              note={`Потолок ответа — ${CTX_LABELS[ctxIdx]} токенов`}
            />
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}
