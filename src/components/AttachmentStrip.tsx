/**
 * Лента вложений над капсулой ввода.
 *
 * Блок 72×72: фото или кадр — сама картинка, документ — только расширение
 * моно по центру (никаких иконок типа: «архив» читался как корзина).
 * Имя файла — строкой под плиткой. Крестик висит в углу
 * плитки, поэтому у контейнера сверху есть отступ 6 px, иначе бейдж срезается.
 * Файлов больше ширины — лента листается вбок, капсула по высоте не растёт.
 */
import React from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import { AppIcon } from "../design-system/components/AppIcon";
import { fonts } from "../theme/tokens";

export type AttachItem = { kind: "image" | "camera" | "file"; uri: string; name?: string };

function extOf(name?: string): string {
  const parts = (name ?? "").split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export function AttachmentStrip({
  items,
  onRemove,
  theme,
}: {
  items: AttachItem[];
  onRemove: (index: number) => void;
  theme: any;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginBottom: 9 }}
      contentContainerStyle={{ gap: 8, paddingTop: 6, paddingRight: 6 }}
    >
      {items.map((a, i) => (
        <View key={`${a.uri}-${i}`} style={{ width: 72 }}>
          <View style={{ width: 72, height: 72, borderRadius: 14, overflow: "hidden", backgroundColor: theme.surface }}>
            {a.kind !== "file" ? (
              <Image source={{ uri: a.uri }} style={{ width: 72, height: 72 }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.2, color: theme.text }}>
                  {(extOf(a.name) || "file").toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.dim, marginTop: 5 }}>
            {a.name ?? (a.kind === "camera" ? "снимок" : "фото")}
          </Text>
          <Pressable
            onPress={() => onRemove(i)}
            hitSlop={10}
            accessibilityLabel="Убрать вложение"
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: theme.bg,
              borderWidth: 1,
              borderColor: theme.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AppIcon name="close" size={11} color={theme.text} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
