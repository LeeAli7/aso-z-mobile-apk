/** Использование: реальный учёт токенов из core/usage.ts. Стиль КРОВЬ. */
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { AppIcon } from "../design-system/components/AppIcon";
import { getUsageSummary, clearUsage, ModelUsage } from "../core/usage";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";
import { confirmDangerous } from "../core/confirm";

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function UsageScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [models, setModels] = useState<ModelUsage[]>([]);
  const [total, setTotal] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 });

  const load = useCallback(() => {
    getUsageSummary()
      .then((s) => { setModels(s.models); setTotal(s.total); })
      .catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>Использование</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: 28, paddingBottom: insets.bottom + 40 }}>
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ color: theme.text, fontSize: 40, fontWeight: "700", letterSpacing: -1.2, fontFamily: fonts.mono }}>
            {fmt(total.totalTokens)}
          </Text>
          <Text style={{ color: theme.mute, fontSize: 13, marginTop: 2 }}>
            токенов · {fmt(total.calls)} {total.calls === 1 ? "запрос" : "запросов"}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 18, gap: 28 }}>
            <View>
              <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 3 }}>вход</Text>
              <Text style={{ color: theme.text, fontSize: 16, fontFamily: fonts.mono }}>{fmt(total.promptTokens)}</Text>
            </View>
            <View>
              <Text style={{ color: theme.mute, fontSize: 11, marginBottom: 3 }}>выход</Text>
              <Text style={{ color: theme.text, fontSize: 16, fontFamily: fonts.mono }}>{fmt(total.completionTokens)}</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: theme.border, marginTop: 28, marginHorizontal: 20 }} />

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={{ color: theme.mute, fontSize: 12, letterSpacing: 0.4, marginBottom: 10 }}>ПО МОДЕЛЯМ</Text>
          {models.length === 0 ? (
            <Text style={{ color: theme.mute, fontSize: 13, lineHeight: 19 }}>
              Пока пусто. Цифры появятся после первого ответа модели — провайдер присылает их вместе со стримом.
            </Text>
          ) : (
            models.map((m) => (
              <View key={m.modelKey} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Text style={{ color: theme.text, fontSize: 13.5, fontFamily: fonts.mono }} numberOfLines={1}>{m.modelKey}</Text>
                <Text style={{ color: theme.mute, fontSize: 11.5, marginTop: 3 }}>
                  вход {fmt(m.promptTokens)} · выход {fmt(m.completionTokens)} · {fmt(m.calls)} запр.
                </Text>
              </View>
            ))
          )}
        </View>

        {models.length > 0 && (
          <Pressable
            onPress={() =>
              confirmDangerous(
                "Сбросить счётчики?",
                "Расход токенов обнулится без возможности отмены.",
                async () => {
                  await clearUsage();
                  setModels([]);
                  setTotal({ promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 });
                },
              )
            }
            style={{ marginTop: 26, paddingHorizontal: 20 }}
            hitSlop={8}
          >
            <Text style={{ color: theme.danger, fontSize: 14 }}>Сбросить счётчики</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
