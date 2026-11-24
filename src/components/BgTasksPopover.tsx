import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AppIcon, type AppIconName } from "../design-system/components/AppIcon";
import { fonts, type Theme } from "../theme/tokens";

export type PopoverTask = {
  kind: "runtime" | "cron" | "delegate" | "stream";
  id: string;
  label: string;
  startedAt: number;
};

const W = 300;
const HEAD = 44;
const ROW = 52;
const GROUP = 26;
const LIST_MAX = 238;

const GROUPS: { kind: PopoverTask["kind"]; title: string; icon: AppIconName }[] = [
  { kind: "runtime", title: "Терминал", icon: "terminal" },
  { kind: "delegate", title: "Субагенты", icon: "account" },
  { kind: "cron", title: "Расписание", icon: "clock" },
];

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Фоновые процессы — окно по образцу выбора модели (макет v70…v75).
 *
 * Чип 47×40 не остаётся под окном: он растёт в панель 300×N на том же месте.
 * Внутри — только фоновая работа, разбитая по типам: терминал, субагенты,
 * расписание. Стрим ответа сюда не попадает — он виден по кнопке в капсуле.
 */
export function BgTasksPopover({
  open,
  tasks,
  onClose,
  onStopAll,
  onOpen,
  theme,
  anchor,
  screenW,
}: {
  open: boolean;
  tasks: PopoverTask[];
  onClose: () => void;
  onStopAll: () => void;
  onOpen?: (t: PopoverTask) => void;
  theme: Theme;
  anchor: { x: number; y: number; w: number; h: number };
  screenW: number;
}) {
  const [mounted, setMounted] = useState(open);
  const p = useSharedValue(0);
  const [, force] = useState(0);

  const items = tasks.filter((t) => t.kind !== "stream");
  const groupRows = GROUPS.map((g) => ({ ...g, rows: items.filter((t) => t.kind === g.kind) })).filter(
    (g) => g.rows.length > 0,
  );
  const content = groupRows.reduce((n, g) => n + GROUP + g.rows.length * ROW, 0);
  const listH = Math.min(content, LIST_MAX);
  const winH = HEAD + 6 + listH + 6 + 46;

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

  // «14 с» на строках должно тикать, иначе цифры врут
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  // окно прижато к правому краю экрана, но никогда не выезжает за него
  const leftTo = Math.max(8, Math.min(anchor.x + anchor.w - W, screenW - W - 8));
  const win = useAnimatedStyle(() => ({
    left: anchor.x + (leftTo - anchor.x) * p.value,
    width: anchor.w + (W - anchor.w) * p.value,
    height: anchor.h + (winH - anchor.h) * p.value,
    borderRadius: 20,
  }));
  const body = useAnimatedStyle(() => ({ opacity: p.value * p.value }));

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 30 }]} pointerEvents={open ? "box-none" : "none"}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть фоновые процессы" />
      <Reanimated.View
        style={[
          {
            position: "absolute",
            top: anchor.y,
            backgroundColor: theme.surface2,
            overflow: "hidden",
          },
          win,
        ]}
      >
        <Reanimated.View style={[{ flex: 1 }, body]}>
          <Pressable
            onPress={onClose}
            style={{ height: HEAD, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 }}
            accessibilityLabel="Закрыть фоновые процессы"
          >
            <Reanimated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.text }, dotStyle]} />
            <Text style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: fonts.sansDemi }}>Фоновые</Text>
            <Text style={{ color: theme.mute, fontSize: 12, fontFamily: fonts.mono }}>{items.length}</Text>
            <AppIcon name="chevron-down" size={14} color={theme.dim} />
          </Pressable>

          <ScrollView style={{ height: listH }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6 }}>
            {groupRows.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 13, paddingVertical: 16, paddingHorizontal: 8 }}>
                Ничего не выполняется
              </Text>
            ) : (
              groupRows.map((g) => (
                <View key={g.kind}>
                  <View style={{ height: GROUP, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
                    <Text
                      style={{ color: theme.mute, fontSize: 10.5, letterSpacing: 0.8, fontFamily: fonts.sansMedium }}
                    >
                      {g.title.toUpperCase()}
                    </Text>
                    <Text style={{ color: theme.mute, fontSize: 10.5, fontFamily: fonts.mono }}>{g.rows.length}</Text>
                  </View>
                  {g.rows.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => onOpen?.(t)}
                      style={({ pressed }) => ({
                        height: ROW,
                        borderRadius: 14,
                        paddingHorizontal: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        backgroundColor: pressed ? "#2C2C31" : "transparent",
                      })}
                    >
                      <AppIcon name={g.icon} size={22} color={theme.dim} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14.5, fontFamily: fonts.sansMedium }}>
                          {t.label}
                        </Text>
                        <Text style={{ color: theme.mute, fontSize: 11, marginTop: 2, fontFamily: fonts.mono }}>
                          {elapsed(t.startedAt)} · идёт
                        </Text>
                      </View>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.text }} />
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </ScrollView>

          <View
            style={{
              height: 1,
              backgroundColor: "#2C2C31",
              marginHorizontal: 6,
            }}
          />
          <View style={{ height: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 8 }}>
            <Pressable
              onPress={onStopAll}
              style={({ pressed }) => ({
                flex: 1,
                height: 34,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? "#2C2C31" : "transparent",
              })}
              accessibilityLabel="Остановить всё"
            >
              <Text style={{ color: theme.danger, fontSize: 13, fontFamily: fonts.sansMedium }}>Остановить всё</Text>
            </Pressable>
          </View>
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
}
