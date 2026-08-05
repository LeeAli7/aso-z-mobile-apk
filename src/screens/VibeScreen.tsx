/**
 * Vibe Coding — список локальных проектов + создание нового.
 * Всё хранится на устройстве (AsyncStorage + documentDirectory).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { PrimaryButton, TextField } from "../components/ui";
import { IconButton } from "../design-system/components/IconButton";
import { EmptyState } from "../design-system/components/EmptyState";
import { Sheet } from "../design-system/components/Sheet";
import { Button } from "../design-system/components/Button";
import { showToast } from "../design-system/components/Toast";
import {
  VibeProject,
  createProject,
  deleteProject,
  listFiles,
  listProjects,
  renameProject,
} from "../core/vibeLocal";

export function VibeScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [menuProject, setMenuProject] = useState<VibeProject | null>(null);
  const [renameText, setRenameText] = useState("");

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
      showToast("err", String(e?.message || e));
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
      showToast("err", String(e?.message || e));
    } finally {
      setCreating(false);
      load();
    }
  }, [name, desc, navigation, load]);

  const remove = useCallback(
    (p: VibeProject) => {
      Alert.alert(t("delete"), `Удалить проект «${p.name}» и все файлы?`, [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteProject(p.id);
              showToast("ok", "Проект удалён");
              load();
            } catch (e: any) {
              showToast("err", String(e?.message || e));
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
        <EmptyState
          icon="folder-open"
          title="Нет проектов"
          subtitle="Создай проект — агент напишет код, файлы сохранятся прямо на устройстве."
          cta={t("newProject")}
          onCta={() => {}}
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate("VibeProject", { id: item.id, name: item.name })}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 11,
                padding: 13,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface,
                marginBottom: 10,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: theme.accentDim, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="folder" size={20} color={theme.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "500" }}>{item.name}</Text>
                {item.desc ? (
                  <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, marginTop: 1 }}>{item.desc}</Text>
                ) : null}
                <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2, fontFamily: "monospace" }}>
                  {(item as any).fileCount ?? 0} файлов · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <IconButton
                name="more-vert"
                size={18}
                onPress={() => { setMenuProject(item); setRenameText(item.name); }}
                haptic
                accessibilityLabel="Меню проекта"
              />
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

      {/* project menu sheet */}
      <Sheet visible={!!menuProject} onClose={() => setMenuProject(null)} title={menuProject?.name ?? ""} snapPoints={["40%"]}>
        {menuProject && (
          <View style={{ gap: 8 }}>
            <Button
              title="Переименовать"
              variant="secondary"
              fullWidth
              onPress={async () => {
                if (renameText.trim() && renameText.trim() !== menuProject.name) {
                  try {
                    await renameProject(menuProject.id, renameText.trim());
                    showToast("ok", "Проект переименован");
                  } catch (e: any) {
                    showToast("err", String(e?.message || e));
                  }
                }
                setMenuProject(null);
                load();
              }}
            />
            <Button title={t("delete")} variant="danger" fullWidth onPress={() => { remove(menuProject); setMenuProject(null); }} />
          </View>
        )}
      </Sheet>
    </View>
  );
}
