/**
 * UsageScreen — использование (реальные данные из core/usage).
 *
 * Суммарные токены + таблица по моделям (prompt/completion/total).
 * gateway пишет через recordUsage, экран читает getUsageSummary.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";
import { getUsageSummary, clearUsage, type ModelUsage } from "../core/usage";
import { showToast } from "../design-system/components/Toast";

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function UsageScreen({ navigation }: { navigation: any }) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<ModelUsage[]>([]);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { models } = await getUsageSummary();
      setStats(models);
    } catch {}
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const total = stats.reduce((a, s) => a + s.totalTokens, 0);
  const totalIn = stats.reduce((a, s) => a + s.promptTokens, 0);
  const totalOut = stats.reduce((a, s) => a + s.completionTokens, 0);

  const doClear = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearUsage();
      setStats([]);
      showToast("ok", "Статистика очищена");
    } finally {
      setClearing(false);
    }
  }, [clearing]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }} accessibilityLabel={t("back")}>
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View>
          <Text style={{ color: theme.dim, fontSize: 11 }}>{t("usage_sub")}</Text>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>{t("usage_title")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {/* суммарно */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { label: t("usage_total"), value: total },
            { label: t("usage_prompt"), value: totalIn },
            { label: t("usage_completion"), value: totalOut },
          ].map((c) => (
            <View key={c.label} style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.mute, fontSize: 10.5 }}>{c.label}</Text>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700", fontFamily: fonts.mono, marginTop: 2 }}>{fmt(c.value)}</Text>
            </View>
          ))}
        </View>

        {/* по моделям */}
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 6 }}>{t("models")}</Text>
        {stats.length === 0 ? (
          <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 18 }}>{t("usage_empty")}</Text>
          </View>
        ) : (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, overflow: "hidden" }}>
            {stats.map((s, i) => (
              <View key={s.modelKey} style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600", fontFamily: fonts.mono }}>{s.modelKey}</Text>
                  <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: fonts.mono }}>{fmt(s.totalTokens)}</Text>
                </View>
                <Text style={{ color: theme.mute, fontSize: 10.5, fontFamily: fonts.mono, marginTop: 2 }}>
                  {t("usage_prompt")}: {fmt(s.promptTokens)} · {t("usage_completion")}: {fmt(s.completionTokens)} · {s.calls}
                </Text>
              </View>
            ))}
          </View>
        )}
        {stats.length > 0 && (
          <Pressable onPress={doClear} disabled={clearing} hitSlop={8} style={{ marginTop: 12, alignSelf: "flex-start", paddingVertical: 6 }}>
            <Text style={{ color: theme.danger, fontSize: 12.5 }}>{clearing ? "…" : t("clear")}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
