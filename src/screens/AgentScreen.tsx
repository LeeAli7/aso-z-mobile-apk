/**
 * Агент — корень-список из 3 отделов-подокон.
 *
 * Отделы: Субагенты / Kanban-доска / Использование.
 * Корень — только список, внутри — контролы и навигация к экранам.
 * Движок не тронут: чистый UI поверх существующих экранов.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, materialToApp } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { DeptRow, DeptDivider, DeptBack, DeptDef } from "../components/Dept";

const AGENTS: { icon: string; name: string; desc: string; tag: string | null; route: string }[] = [
  { icon: "groups", name: "Субагенты", desc: "Параллельные задачи: лимит и настройка", tag: "Настройка", route: "AgentSettings" },
  { icon: "chat", name: "Обычный чат", desc: "Агент с инструментами в главном чате", tag: "Открыть", route: "Main" },
  { icon: "code", name: "Кодер", desc: "Пишет и правит код в проекте", tag: "Проекты", route: "Vibe" },
  { icon: "terminal", name: "Терминал", desc: "Команды в нативном рантайме", tag: "Открыть", route: "Terminal" },
];

type DeptKey = "subagents" | "kanban" | "usage";

export function AgentScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [dept, setDept] = useState<DeptKey | null>(null);

  const depts: (DeptDef & { key: DeptKey })[] = [
    { key: "subagents", title: t("dept_subagents"), sub: `${AGENTS.length}`, icon: "group" },
    { key: "kanban", title: t("kanban_title"), sub: t("kanban_sub"), icon: "check" },
    { key: "usage", title: t("usage_title"), sub: t("usage_sub"), icon: "trend" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }} accessibilityLabel={t("back")}>
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>Агенты</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {/* корень — только список отделов */}
        {dept === null && (
          <View style={{ borderRadius: 20, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            {depts.map((d, i) => (
              <View key={d.key}>
                {i > 0 && <DeptDivider theme={theme} />}
                <DeptRow
                  dept={d}
                  theme={theme}
                  onPress={() => {
                    if (d.key === "kanban") navigation.navigate("Kanban");
                    else if (d.key === "usage") navigation.navigate("Usage");
                    else setDept(d.key);
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {/* ── Субагенты ── */}
        {dept === "subagents" && (
          <>
            <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 18, marginBottom: 10 }}>
              {t("subagents_desc")}
            </Text>
            {AGENTS.map((a) => (
              <Pressable
                key={a.name}
                onPress={() => navigation.navigate(a.route)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 12,
                  padding: 13, borderRadius: 20, marginBottom: 8,
                  backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accentDim, alignItems: "center", justifyContent: "center" }}>
                  <AppIcon name={materialToApp(a.icon)} size={20} color={theme.accentHi} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{a.name}</Text>
                  <Text style={{ color: theme.dim, fontSize: 11.5, marginTop: 2 }}>{a.desc}</Text>
                </View>
                <AppIcon name="chevron-right" size={18} color={theme.mute} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => navigation.navigate("AgentSettings")}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                padding: 13, borderRadius: 20, marginTop: 4,
                backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.accentHi, fontSize: 13, fontWeight: "600" }}>Настройки агента: память, навыки</Text>
              </View>
              <AppIcon name="chevron-right" size={18} color={theme.mute} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
