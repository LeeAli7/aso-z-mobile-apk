import React, { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AppIcon } from "../design-system/components/AppIcon";
import { fonts, type Theme } from "../theme/tokens";
import { CTX_LABELS, CTX_STEPS, REASONING_LABELS, type ModelPrefs } from "../core/modelPrefs";

type Model = {
  modelName: string;
  displayName?: string;
  providerName?: string;
  caps?: string[];
};

/**
 * Ползунок по шагам: дорожка 4 px, головка 18. Тянуть можно, тапать можно —
 * значение встаёт на ближайшую ступень, промежуточных нет.
 */
function StepSlider({
  label,
  value,
  steps,
  onChange,
  theme,
  suffix,
}: {
  label: string;
  value: number;
  steps: string[];
  onChange: (i: number) => void;
  theme: Theme;
  suffix?: string;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const set = (x: number) => {
    if (wRef.current <= 0) return;
    const pad = 9;
    const inner = Math.max(1, wRef.current - pad * 2);
    const t = Math.min(1, Math.max(0, (x - pad) / inner));
    const i = Math.round(t * (steps.length - 1));
    if (i !== value) onChange(i);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
      onPanResponderMove: (e) => set(e.nativeEvent.locationX),
    }),
  ).current;
  const pct = steps.length > 1 ? value / (steps.length - 1) : 0;

  return (
    <View style={{ height: 56, justifyContent: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 10 }}>
        <Text style={{ flex: 1, color: theme.dim, fontSize: 12.5, fontFamily: fonts.sansMedium }}>{label}</Text>
        <Text style={{ color: theme.text, fontSize: 12.5, fontFamily: fonts.mono }}>
          {steps[value]}
          {suffix ?? ""}
        </Text>
      </View>
      <View
        {...pan.panHandlers}
        onLayout={(e) => {
          const nw = e.nativeEvent.layout.width;
          wRef.current = nw;
          setW(nw);
        }}
        style={{ height: 24, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.border }} />
        <View
          style={{
            position: "absolute",
            left: 0,
            height: 4,
            borderRadius: 2,
            width: Math.max(0, 9 + pct * Math.max(0, w - 18)),
            backgroundColor: theme.text,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: Math.max(0, pct * Math.max(0, w - 18)),
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.text,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Выбор модели — окно раскрывается ВВЕРХ НА МЕСТЕ кнопки.
 *
 * Поверхность растёт из капсулы 118×40 в окно 300×N, радиус 26 → 20.
 * Внутри: модели по провайдерам (включая свои), ползунки рассуждения и
 * контекста, и вход в добавление своей модели.
 */
export function ModelPickerPopover({
  open,
  models,
  current,
  onSelect,
  onClose,
  theme,
  top,
  right = 10,
  prefs,
  caps,
  onPrefs,
  onAdd,
}: {
  open: boolean;
  models: Model[];
  current?: string;
  onSelect: (m: Model) => void;
  onClose: () => void;
  theme: Theme;
  top: number;
  right?: number;
  prefs: ModelPrefs;
  caps: string[];
  onPrefs: (p: ModelPrefs) => void;
  onAdd: () => void;
}) {
  const [mounted, setMounted] = useState(open);
  const p = useSharedValue(0);

  const canReason = caps.includes("reasoning");
  const listH = Math.min(4, Math.max(1, models.length)) * 44 + 8;
  const paramsH = canReason ? 56 : 0;
  const targetH = 52 + listH + paramsH + 56 + 44 + 10;
  const targetW = 300;

  useEffect(() => {
    if (open) {
      setMounted(true);
      p.value = withTiming(1, { duration: 260, easing: REasing.out(REasing.cubic) });
      return;
    }
    p.value = withTiming(0, { duration: 180, easing: REasing.in(REasing.cubic) });
    const id = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(id);
  }, [open, p]);

  const box = useAnimatedStyle(() => ({
    width: 118 + (targetW - 118) * p.value,
    height: 40 + (targetH - 40) * p.value,
    borderRadius: 26 + (20 - 26) * p.value,
  }));
  const body = useAnimatedStyle(() => ({ opacity: p.value * p.value }));

  if (!mounted) return null;

  // группы по провайдеру: свои провайдеры видны по имени, а не свалкой
  const groups: { name: string; rows: Model[] }[] = [];
  for (const m of models) {
    const g = m.providerName ?? "Aso";
    let bucket = groups.find((x) => x.name === g);
    if (!bucket) {
      bucket = { name: g, rows: [] };
      groups.push(bucket);
    }
    bucket.rows.push(m);
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть выбор модели" />
      <Reanimated.View
        style={[
          {
            position: "absolute",
            right,
            top,
            backgroundColor: theme.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            overflow: "hidden",
          },
          box,
        ]}
      >
        <Reanimated.View style={[{ flex: 1 }, body]}>
          <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 16 }}>
            <Text style={{ color: theme.mute, fontSize: 11.5, letterSpacing: 0.8, fontFamily: fonts.sansMedium }}>
              МОДЕЛЬ
            </Text>
          </View>

          <ScrollView
            style={{ height: listH }}
            contentContainerStyle={{ paddingBottom: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {models.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 }}>
                Модели не подключены
              </Text>
            ) : (
              groups.map((g) => (
                <View key={g.name}>
                  {groups.length > 1 ? (
                    <Text
                      style={{
                        color: theme.mute,
                        fontSize: 10.5,
                        letterSpacing: 0.7,
                        paddingHorizontal: 16,
                        paddingTop: 8,
                        paddingBottom: 2,
                        fontFamily: fonts.sansMedium,
                      }}
                    >
                      {g.name.toUpperCase()}
                    </Text>
                  ) : null}
                  {g.rows.map((m) => {
                    const on = m.modelName === current;
                    return (
                      <Pressable
                        key={m.modelName}
                        onPress={() => onSelect(m)}
                        style={({ pressed }) => ({
                          height: 44,
                          paddingHorizontal: 16,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          backgroundColor: pressed ? theme.surface2 : "transparent",
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={m.displayName ?? m.modelName}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            flex: 1,
                            color: on ? theme.text : theme.dim,
                            fontSize: 13.5,
                            fontFamily: on ? fonts.sansDemi : fonts.sansMedium,
                          }}
                        >
                          {m.displayName ?? m.modelName}
                        </Text>
                        {on ? <AppIcon name="check" size={16} color={theme.text} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginTop: 4 }} />

          <View style={{ paddingHorizontal: 16 }}>
            {canReason ? (
              <StepSlider
                label="Рассуждение"
                value={prefs.reasoning}
                steps={[...REASONING_LABELS]}
                theme={theme}
                onChange={(i) => onPrefs({ ...prefs, reasoning: i as ModelPrefs["reasoning"] })}
              />
            ) : null}
            <StepSlider
              label="Контекст"
              value={Math.max(0, CTX_STEPS.findIndex((c) => c >= prefs.ctx))}
              steps={[...CTX_LABELS]}
              theme={theme}
              onChange={(i) => onPrefs({ ...prefs, ctx: CTX_STEPS[i] })}
            />
          </View>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />
          <Pressable
            onPress={onAdd}
            style={({ pressed }) => ({
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
              backgroundColor: pressed ? theme.surface2 : "transparent",
            })}
            accessibilityRole="button"
            accessibilityLabel="Добавить провайдера и модель"
          >
            <AppIcon name="plus" size={16} color={theme.dim} />
            <Text style={{ color: theme.dim, fontSize: 13, fontFamily: fonts.sansMedium }}>
              Провайдер и модель
            </Text>
          </Pressable>
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
}
