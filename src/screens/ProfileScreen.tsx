/**
 * Мои (вкладка 4, как в Kimi): профиль, подписка, настройки.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";

export function ProfileScreen({ navigation }: { navigation: any }) {
  const { state, theme } = useApp();
  const insets = useSafeAreaInsets();

  const rows: { icon: any; label: string; onPress: () => void; danger?: boolean }[] = [
    { icon: "tune", label: "Настройки", onPress: () => navigation.navigate("Settings") },
    { icon: "extension", label: "Провайдеры и модели", onPress: () => navigation.navigate("Providers") },
    { icon: "folder-open", label: "Мои проекты", onPress: () => showProjectsToast() },
  ];

  function showProjectsToast() {
    const { showToast } = require("../design-system/components/Toast");
    showToast("info", "Проекты — в шапке чата");
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 8 }}>
        <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono, letterSpacing: 0.8 }}>PROFILE</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 90 }}>
        {/* профиль */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.onAccent, fontSize: 18, fontWeight: "700" }}>
              {state.profile?.username?.slice(0, 2).toUpperCase() || "AS"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600", fontFamily: fonts.sansDemi }}>
              {state.profile?.username || "Не синхронизировано"}
            </Text>
            <Text style={{ color: theme.dim, fontSize: 11.5, fontFamily: fonts.mono, marginTop: 2 }}>
              {state.profile?.telegramId ? `tg ${state.profile.telegramId}` : "Aso-z 2.0"}
            </Text>
          </View>
          {state.profile?.premium && (
            <Text style={{ color: theme.warn, fontSize: 9, letterSpacing: 1, borderWidth: 1, borderColor: theme.warn + "66", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, fontFamily: fonts.mono }}>
              PREMIUM
            </Text>
          )}
        </View>

        {/* квота */}
        {state.profile && (
          <View style={{ marginTop: 10, padding: 14, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: theme.dim, fontSize: 12 }}>Дневной лимит</Text>
              <Text style={{ color: theme.text, fontSize: 12, fontFamily: fonts.mono }}>
                {state.profile.quotaUsed.toLocaleString()} / {state.profile.quotaLimit.toLocaleString()}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 99, backgroundColor: theme.surface2, overflow: "hidden" }}>
              <View
                style={{
                  width: `${state.profile.quotaLimit ? Math.min(100, (state.profile.quotaUsed / state.profile.quotaLimit) * 100) : 0}%`,
                  height: 6, borderRadius: 99, backgroundColor: theme.accent,
                }}
              />
            </View>
          </View>
        )}

        {/* меню */}
        <View style={{ marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.border, overflow: "hidden", backgroundColor: theme.surface }}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                paddingHorizontal: 14, paddingVertical: 13,
                backgroundColor: theme.surface,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: theme.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <MaterialIcons name={r.icon} size={19} color={r.danger ? theme.danger : theme.accentHi} />
              <Text style={{ color: r.danger ? theme.danger : theme.text, fontSize: 13.5, flex: 1 }}>{r.label}</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}