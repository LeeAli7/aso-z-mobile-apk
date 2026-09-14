/**
 * BgTasksSheet — шторка фоновых процессов.
 *
 * Тихий индикатор: видна ТОЛЬКО когда есть запущенные фоновые
 * (рантайм-сессии, включённый cron, задачи делегации).
 * Тап по индикатору раскрывает лист: список задач + стоп/посмотреть.
 * Нет фоновых — компонент не рендерит ничего.
 *
 * Источники (движок, read-only):
 *  - рантайм-сессии: ChatScreen передаёт через props (активные runState)
 *    — NATIVE OWNER (Арес): listRunning() в runtime.ts заменит пропсы.
 *  - cron: loadJobs() — включённые джобы (ожидают расписания).
 *  - делегация: runDelegation — активные tasks через props.
 *
 * Движок не тронут: чистый UI поверх loadJobs + пропсов.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { Sheet } from "../design-system/components/Sheet";
import { loadJobs, CronJob } from "../core/cron";

export interface BgTask {
  id: string;
  kind: "runtime" | "cron" | "delegation" | "stream";
  title: string;
  sub?: string;
}

export function BgTasksSheet({
  visible,
  onClose,
  theme,
  t,
  tasks,
  onStop,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  theme: any;
  t: (k: any) => string;
  tasks: BgTask[];
  onStop?: (task: BgTask) => void;
  onOpen?: (task: BgTask) => void;
}) {
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  useEffect(() => {
    if (!visible) return;
    void loadJobs().then(setJobs).catch(() => {});
  }, [visible]);
  const enabled = jobs.filter((j) => j.enabled);
  const all: BgTask[] = [...tasks];
  for (const j of enabled) {
    if (!all.some((x) => x.id === "cron:" + j.id)) {
      all.push({ id: "cron:" + j.id, kind: "cron", title: j.name, sub: j.schedule });
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t("bg_title") ?? "Фоновые процессы"} snapPoints={["50%"]}>
      {all.length === 0 ? (
        <Text style={{ color: theme.dim, fontSize: 12.5 }}>{t("bg_empty") ?? "Фоновых задач нет."}</Text>
      ) : (
        all.map((task) => (
          <View
            key={task.id}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: task.kind === "stream" ? theme.accent : theme.ok }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{task.title}</Text>
              {task.sub ? <Text style={{ color: theme.mute, fontSize: 10.5, fontFamily: "monospace", marginTop: 1 }}>{task.sub}</Text> : null}
            </View>
            {onOpen ? (
              <Pressable onPress={() => onOpen(task)} hitSlop={8} style={{ padding: 6 }}>
                <AppIcon name="eye" size={17} color={theme.accentHi} />
              </Pressable>
            ) : null}
            {onStop ? (
              <Pressable onPress={() => onStop(task)} hitSlop={8} style={{ padding: 6 }}>
                <AppIcon name="stop" size={15} color={theme.danger} />
              </Pressable>
            ) : null}
          </View>
        ))
      )}
      <View style={{ height: insets.bottom + 8 }} />
    </Sheet>
  );
}

/** Тихий индикатор фоновых: точка + счётчик, только если tasks непуст. */
export function BgIndicator({
  theme,
  count,
  onPress,
}: {
  theme: any;
  count: number;
  onPress: () => void;
}) {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
      }}
      accessibilityLabel="Фоновые процессы"
      accessibilityRole="button"
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.ok }} />
      <Text style={{ color: theme.dim, fontSize: 11.5, fontWeight: "600" }}>{count}</Text>
    </Pressable>
  );
}
