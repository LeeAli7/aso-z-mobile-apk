/**
 * Агент (вкладка 3, как в Kimi): агенты, наборы (Agent Swarm, Kimi Claw).
 * Тексты — из RU-строк APK Kimi (agent_swarm_*, claw_group_home_*).
 */
import React from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";
import { showToast } from "../design-system/components/Toast";

const AGENTS = [
  { icon: "groups", name: "Agent Swarm", desc: "Несколько агентов параллельно", tag: "Экспериментально" },
  { icon: "chat", name: "Kimi Claw", desc: "Групповой чат с агентами", tag: null },
  { icon: "code", name: "Кодер", desc: "Пишет и правит код в проекте", tag: "Vibe" },
  { icon: "terminal", name: "Терминал", desc: "Выполняет команды через Termux", tag: "Vibe" },
];

export function AgentScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 8 }}>
        <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono, letterSpacing: 0.8 }}>AGENTS</Text>
      </View>
      <FlatList
        data={AGENTS}
        keyExtractor={(a) => a.name}
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 90 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => showToast("info", `${item.name} — готовлю…`)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 12,
              padding: 13, borderRadius: 14, marginBottom: 8,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accentDim, alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name={item.icon as any} size={20} color={theme.accentHi} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600", fontFamily: fonts.sansDemi }}>{item.name}</Text>
                {item.tag ? (
                  <Text style={{ color: theme.accentHi, fontSize: 8.5, letterSpacing: 0.8, borderWidth: 1, borderColor: theme.accentDim, backgroundColor: theme.accentDim, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, fontFamily: fonts.mono }}>
                    {item.tag.toUpperCase()}
                  </Text>
                ) : null}
              </View>
              <Text style={{ color: theme.dim, fontSize: 11.5, marginTop: 2 }}>{item.desc}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
          </Pressable>
        )}
      />
    </View>
  );
}