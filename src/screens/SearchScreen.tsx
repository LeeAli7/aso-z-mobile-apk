/**
 * Поиск (вкладка 2, как в Kimi): капсула-строка поиска + подсказки/темы.
 * Тексты — из RU-строк APK Kimi (intelligent_search, community_search_*).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";

const HOT_TOPICS = [
  "DeepSeek R1 против Qwen",
  "React Native 0.8",
  "Как устроен Termux",
  "Python асинхронность",
  "Kotlin Multiplatform",
  "Нейросети на телефоне",
];

export function SearchScreen() {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 8 }}>
        <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono, letterSpacing: 0.8 }}>SEARCH</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, backgroundColor: theme.surface2, borderRadius: 24, paddingHorizontal: 14, height: 46 }}>
          <MaterialIcons name="search" size={18} color={theme.mute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Умный поиск…"
            placeholderTextColor={theme.mute}
            style={{ flex: 1, fontSize: 14, color: theme.text, fontFamily: fonts.sansMedium }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 90 }}>
        <Text style={{ color: theme.dim, fontSize: 12, fontFamily: fonts.mono, letterSpacing: 0.5, marginBottom: 10 }}>АКТУАЛЬНЫЕ ТЕМЫ</Text>
        {HOT_TOPICS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setQ(t)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 10,
              paddingVertical: 12, paddingHorizontal: 10,
              borderRadius: 12, marginBottom: 4,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <MaterialIcons name="trending-up" size={15} color={theme.accentHi} />
            <Text style={{ color: theme.text, fontSize: 13, flex: 1 }}>{t}</Text>
            <MaterialIcons name="chevron-right" size={16} color={theme.mute} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}