/**
 * Хранилище — файлы на устройстве, доступные агенту.
 *
 * Реальное содержимое через рантайм (ls -la): папки открываются, файлы
 * показываются целиком (читаемый текст), путь можно скопировать, удаление —
 * с подтверждением. Ничего не выдумывает: недоступный путь так и пишет.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { AppIcon } from "../design-system/components/AppIcon";
import { fonts } from "../theme/tokens";
import { useApp } from "../store/AppStore";
import { runCommandCapture, runtimeAvailable } from "../core/runtime";

type Entry = { name: string; dir: boolean; size: string };
type Section = { path: string; entries: Entry[]; error?: string };

const ROOTS = ["~", "/storage/emulated/0/Aso", "/storage/emulated/0/Download"];
const PREVIEW_LIMIT = 20000;

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

const join = (base: string, name: string) => (base.endsWith("/") ? base + name : base + "/" + name);
const parentOf = (path: string) => {
  if (path === "~" || path === "/") return path;
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "~";
  return path.slice(0, idx);
};

export function StorageScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState("~");
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ name: string; full: string; text: string; binary: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!runtimeAvailable()) {
      setSections([{ path, entries: [], error: "Рантайм доступен только на Android" }]);
      setLoading(false);
      return;
    }
    const out: Section[] = [];
    const targets = path === "~" ? ROOTS : [path];
    for (const p of targets) {
      const res = await runCommandCapture(`ls -la "${p}" 2>&1 | head -80`, undefined, undefined);
      if (res.ok) out.push({ path: p, entries: parseLs(res.output) });
      else out.push({ path: p, entries: [], error: (res.error || res.output || "нет доступа").slice(0, 160) });
    }
    setSections(out);
    setLoading(false);
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = useCallback(
    async (full: string, name: string) => {
      setBusy(true);
      try {
        const res = await runCommandCapture(`head -c ${PREVIEW_LIMIT} "${full}" 2>&1`);
        const text = res.ok ? res.output : res.error || res.output || "не читается";
        const binary = /[\u0000-\u0008\u000E-\u001F]/.test(text);
        // обрезка больше не тихая: пользователь видит, что показано не всё
        const cut = res.ok && text.length >= PREVIEW_LIMIT
          ? `\n\n… показаны первые ${Math.round(PREVIEW_LIMIT / 1024)} КБ файла`
          : "";
        setPreview({
          name,
          full,
          text: binary ? "двоичный файл — предпросмотр недоступен" : text + cut,
          binary,
        });
      } catch (e: any) {
        setPreview({ name, full, text: `не удалось прочитать: ${String(e?.message || e)}`, binary: true });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const removeFile = useCallback(
    (full: string, name: string) => {
      Alert.alert("Удалить файл?", `${name}\n\nЭто навсегда.`, [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            await runCommandCapture(`rm -rf "${full}" 2>&1`);
            setPreview(null);
            void load();
          },
        },
      ]);
    },
    [load],
  );

  const atRoot = path === "~";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: insets.top + 6, paddingBottom: 6 }}>
        <Pressable
          onPress={() => (atRoot ? navigation.goBack() : setPath(parentOf(path)))}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityLabel={atRoot ? "Назад" : "На уровень вверх"}
        >
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontFamily: fonts.mono }}>
          {path}
        </Text>
        <Pressable
          onPress={() => void Clipboard.setStringAsync(path)}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityLabel="Скопировать путь"
        >
          <AppIcon name="copy" size={19} color={theme.dim} />
        </Pressable>
        <Pressable
          onPress={() => void load()}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityLabel="Обновить"
        >
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
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} tintColor={theme.text} />}
        >
          {sections.map((s) => (
            <View key={s.path} style={{ marginTop: 18 }}>
              <Text style={{ color: theme.dim, fontSize: 12, fontFamily: fonts.mono, marginBottom: 8 }}>{s.path}</Text>
              {s.error ? (
                <Text style={{ color: theme.danger, fontSize: 12.5, fontFamily: fonts.mono }}>{s.error}</Text>
              ) : s.entries.length === 0 ? (
                <Text style={{ color: theme.mute, fontSize: 13 }}>Пусто</Text>
              ) : (
                s.entries.map((e) => {
                  const full = join(s.path, e.name);
                  return (
                    <Pressable
                      key={full}
                      onPress={() => (e.dir ? setPath(full) : void openFile(full, e.name))}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        minHeight: 44,
                        paddingRight: 4,
                        borderRadius: 12,
                        backgroundColor: pressed ? theme.surface2 : "transparent",
                      })}
                      accessibilityLabel={e.dir ? `Открыть папку ${e.name}` : `Открыть файл ${e.name}`}
                    >
                      <AppIcon name={e.dir ? "folder" : "file"} size={18} color={e.dir ? theme.text : theme.dim} />
                      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15 }}>
                        {e.name}
                      </Text>
                      {!e.dir && <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono }}>{e.size}</Text>}
                      {e.dir && <AppIcon name="chevron-right" size={16} color={theme.mute} />}
                    </Pressable>
                  );
                })
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {preview && (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.scrim }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPreview(null)} accessibilityLabel="Закрыть" />
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 18,
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 18,
              maxHeight: "72%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: "600" }}>
                {preview.name}
              </Text>
              <Pressable onPress={() => setPreview(null)} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Закрыть">
                <AppIcon name="close" size={18} color={theme.dim} />
              </Pressable>
            </View>
            <Text style={{ color: theme.mute, fontSize: 11.5, fontFamily: fonts.mono, marginBottom: 10 }}>{preview.full}</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              <Text selectable style={{ color: theme.text, fontSize: 12.5, lineHeight: 19, fontFamily: fonts.mono }}>
                {preview.text.trim() || "файл пуст"}
              </Text>
            </ScrollView>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 }}>
              <Pressable onPress={() => void Clipboard.setStringAsync(preview.full)} hitSlop={8}>
                <Text style={{ color: theme.text, fontSize: 15 }}>Скопировать путь</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => removeFile(preview.full, preview.name)} hitSlop={8} accessibilityLabel="Удалить файл">
                <Text style={{ color: theme.danger, fontSize: 15 }}>Удалить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {busy && (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.text} />
        </View>
      )}
    </View>
  );
}
