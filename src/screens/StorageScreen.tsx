/**
 * Хранилище — файлы на устройстве, доступные агенту.
 *
 * Показывает реальное содержимое рабочих папок через рантайм (ls -la):
 * домашнюю папку рантайма и общую папку Aso в Download. Ничего не выдумывает:
 * если путь пуст или недоступен — так и пишет.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { fonts } from "../theme/tokens";
import { useApp } from "../store/AppStore";
import { runCommandCapture, runtimeAvailable } from "../core/runtime";

type Entry = { name: string; dir: boolean; size: string };
type Section = { path: string; entries: Entry[]; error?: string };

const PATHS = ["~", "/storage/emulated/0/Aso", "/storage/emulated/0/Download"];

function parseLs(out: string): Entry[] {
  const rows: Entry[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^([\-dl])([rwx-]{9})\s+\d+\s+\S+\s+\S+\s+(\S+)\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (!m) continue;
    const name = m[4].trim();
    if (!name || name === "." || name === "..") continue;
    rows.push({ name, dir: m[1] === "d", size: m[3] });
  }
  return rows;
}

export function StorageScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    if (!runtimeAvailable()) {
      setSections([{ path: "—", entries: [], error: "Рантайм доступен только на Android" }]);
      setLoading(false);
      return;
    }
    const out: Section[] = [];
    for (const p of PATHS) {
      const res = await runCommandCapture(`ls -la "${p}" 2>&1 | head -60`);
      if (res.ok) {
        out.push({ path: p, entries: parseLs(res.output) });
      } else {
        out.push({ path: p, entries: [], error: (res.error || res.output || "нет доступа").slice(0, 160) });
      }
    }
    setSections(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: insets.top + 6, paddingBottom: 6 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Назад">
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: "600" }}>Хранилище</Text>
        <Pressable onPress={() => void load()} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Обновить">
          <AppIcon name="refresh" size={19} color={theme.dim} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={theme.text} />}
        >
          {sections.map((s) => (
            <View key={s.path} style={{ marginTop: 18 }}>
              <Text style={{ color: theme.dim, fontSize: 12, fontFamily: fonts.mono, marginBottom: 8 }}>{s.path}</Text>
              {s.error ? (
                <Text style={{ color: theme.danger, fontSize: 12.5, fontFamily: fonts.mono }}>{s.error}</Text>
              ) : s.entries.length === 0 ? (
                <Text style={{ color: theme.mute, fontSize: 13 }}>Пусто</Text>
              ) : (
                s.entries.map((e) => (
                  <View key={s.path + e.name} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
                    <AppIcon name={e.dir ? "folder" : "file"} size={18} color={e.dir ? theme.text : theme.dim} />
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15 }}>{e.name}</Text>
                    {!e.dir && <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono }}>{e.size}</Text>}
                  </View>
                ))
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
