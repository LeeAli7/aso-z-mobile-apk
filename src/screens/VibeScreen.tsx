/**
 * Vibe Coding — список локальных проектов + создание нового.
 * Всё хранится на устройстве (AsyncStorage + documentDirectory).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../store/AppStore";
import { PrimaryButton, TextField } from "../components/ui";
import {
  VibeProject,
  createProject,
  deleteProject,
  listFiles,
  listProjects,
} from "../core/vibeLocal";

export function VibeScreen({ navigation }: { navigation: any }) {
  const { state, theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await listProjects();
      // подмешиваем счётчик файлов
      const withFiles = await Promise.all(
        list.map(async (p) => {
          const files = await listFiles(p.id).catch(() => []);
          return { ...p, fileCount: files.length };
        }),
      );
      setProjects(withFiles as any);
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      const p = await createProject(n, desc);
      setName("");
      setDesc("");
      navigation.navigate("VibeProject", { id: p.id, name: p.name });
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setCreating(false);
      load();
    }
  }, [name, desc, navigation, load]);

  const remove = useCallback(
    (p: VibeProject) => {
      Alert.alert(t("delete"), p.name, [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteProject(p.id);
              load();
            } catch (e: any) {
              Alert.alert("Error", String(e?.message || e));
            }
          },
        },
      ]);
    },
    [load, t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ color: theme.dim, fontSize: 11 }}>{t("vibe_sub")}</Text>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.3 }}>{t("vibe_title")}</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.dim, fontSize: 13 }}>…</Text>
        </View>
      ) : projects.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700", marginBottom: 6 }}>Нет проектов</Text>
          <Text style={{ color: theme.dim, fontSize: 13, textAlign: "center" }}>
            Создай проект — агент напишет код, файлы сохранятся прямо на устройстве.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate("VibeProject", { id: item.id, name: item.name })}
              onLongPress={() => remove(item)}
              style={{ flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 10 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#1c1202", fontFamily: "monospace", fontSize: 12, fontWeight: "700" }}>{item.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "500" }}>{item.name}</Text>
                <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2, fontFamily: "monospace" }}>
                  {(item as any).fileCount ?? 0} файлов · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={{ color: theme.accentHi, fontSize: 15 }}>›</Text>
            </Pressable>
          )}
        />
      )}

      {/* bottom create section */}
      <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
        <TextField value={name} onChangeText={setName} placeholder={t("project_name")} />
        <View style={{ height: 8 }} />
        <TextField value={desc} onChangeText={setDesc} placeholder={t("project_desc")} />
        <View style={{ height: 10 }} />
        <PrimaryButton title={"＋ " + t("newProject")} onPress={create} disabled={creating || !name.trim()} />
      </View>
    </View>
  );
}
