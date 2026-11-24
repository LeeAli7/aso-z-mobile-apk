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
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { Sheet } from "../design-system/components/Sheet";
import { loadJobs, CronJob } from "../core/cron";
import { listRunning, stopBg } from "../core/background";

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
  // реальный реестр фоновых задач (не локальная заглушка экрана)
  const [reg, setReg] = useState<BgTask[]>([]);
  const refresh = useCallback(() => {
    void loadJobs().then(setJobs).catch(() => {});
    void listRunning()
      .then((list) =>
        setReg(
          list
            .filter((x) => x.kind !== "cron")
            .map((x) => ({
              id: x.id,
              kind: x.kind as BgTask["kind"],
              title: x.label,
              sub: x.kind === "runtime" ? "терминал" : x.kind === "delegate" ? "субагенты" : "стрим",
            })),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!visible) return;
    refresh();
  }, [visible, refresh]);
  const enabled = jobs.filter((j) => j.enabled);
  // «stream» — это текущий ответ модели, а не фоновый процесс: в окне ему не место
  const all: BgTask[] = reg.filter((x) => x.kind !== "stream");
  for (const task of tasks) {
    if (task.kind === "stream") continue;
    if (!all.some((x) => x.id === task.id)) all.push(task);
  }
  for (const j of enabled) {
    if (!all.some((x) => x.id === "cron:" + j.id)) {
      all.push({ id: "cron:" + j.id, kind: "cron", title: j.name, sub: j.schedule });
    }
  }
  const stopTask = useCallback(
    async (task: BgTask) => {
      // cron → пауза задачи, runtime/delegate/stream → abort через реестр
      await stopBg(task.kind === "delegation" ? "delegate" : (task.kind as any), task.id).catch(() => false);
      onStop?.(task);
      refresh();
    },
    [onStop, refresh],
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={t("bg_title") ?? "Фоновые процессы"} snapPoints={["50%"]}>
      {all.length === 0 ? (
        <Text style={{ color: theme.dim, fontSize: 12.5 }}>{t("bg_empty") ?? "Фоновых задач нет."}</Text>
      ) : (
        [
          { kind: "runtime", label: "Рантайм" },
          { kind: "delegation", label: "Делегация" },
          { kind: "cron", label: "Автозадачи" },
        ].map((group) => {
          const rows = all.filter((x) => x.kind === group.kind);
          if (rows.length === 0) return null;
          return (
            <View key={group.kind}>
              <Text style={{ color: theme.mute, fontSize: 11, letterSpacing: 0.7, marginTop: 14, marginBottom: 4, fontFamily: "MiSansLatin-Medium" }}>
                {group.label.toUpperCase()}
              </Text>
              {rows.map((task) => (
                <View
                  key={task.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.ok }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontFamily: "MiSansLatin-Medium" }}>{task.title}</Text>
                    {task.sub ? <Text style={{ color: theme.mute, fontSize: 10.5, fontFamily: "GeistMono", marginTop: 1 }}>{task.sub}</Text> : null}
                  </View>
                  {onOpen ? (
                    <Pressable onPress={() => onOpen(task)} hitSlop={8} style={{ padding: 6 }}>
                      <AppIcon name="eye" size={17} color={theme.dim} />
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => void stopTask(task)} hitSlop={8} style={{ padding: 6 }} accessibilityLabel="Остановить задачу">
                    <AppIcon name="stop" size={15} color={theme.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })
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
        width: 47, height: 40, borderRadius: 20,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        marginRight: 8,
        backgroundColor: theme.surface,
      }}
      accessibilityLabel="Фоновые процессы"
      accessibilityRole="button"
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.ok }} />
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{count}</Text>
    </Pressable>
  );
}
