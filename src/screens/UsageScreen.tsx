/**
 * UsageScreen — использование (заготовка, «скоро»).
 * План: токены, лимиты, расход по моделям и провайдерам.
 * Движок не тронут: только навигация и текст.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";

export function UsageScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }} accessibilityLabel="Назад">
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View>
          <Text style={{ color: theme.dim, fontSize: 11 }}>USAGE</Text>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>Использование</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600", marginBottom: 6 }}>Скоро</Text>
          <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 18 }}>
            Здесь будут: расход токенов, лимиты и статистика по моделям и провайдерам.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
