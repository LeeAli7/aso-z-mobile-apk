/**
 * Dept — корень отделов-подокон: список со стрелками, у каждого свой значок.
 *
 * 3 сета значков (Али выберет один):
 *  - A LineArt тонкий: stroke 1.5, без подложки, цвет dim (как панель B)
 *  - B минимал-заливка: чип 34px accentDim + глиф accentHi, stroke 1.8
 *  - C моно: stroke 2.0, цвет text, без подложки
 *
 * Переключение: ICON_SET ('A' | 'B' | 'C'). По умолчанию 'A'.
 * Движок не тронут: чистый визуал поверх AppIcon.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { AppIcon, AppIconName } from "../design-system/components/AppIcon";

export type IconSet = "A" | "B" | "C";
export const ICON_SET: IconSet = "A";

export interface DeptDef {
  key: string;
  title: string;
  sub?: string;
  icon: AppIconName;
}

export function DeptIcon({ name, theme, set = ICON_SET }: { name: AppIconName; theme: any; set?: IconSet }) {
  if (set === "B") {
    return (
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.accentDim, alignItems: "center", justifyContent: "center" }}>
        <AppIcon name={name} size={18} color={theme.accentHi} strokeWidth={1.8} />
      </View>
    );
  }
  if (set === "C") {
    return <AppIcon name={name} size={20} color={theme.text} strokeWidth={2.0} />;
  }
  return <AppIcon name={name} size={20} color={theme.dim} strokeWidth={1.5} />;
}

export function DeptRow({
  dept, theme, onPress, set = ICON_SET,
}: {
  dept: DeptDef; theme: any; onPress: () => void; set?: IconSet;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.ripple }}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingHorizontal: 14, paddingVertical: 12,
        backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel={dept.title}
    >
      <DeptIcon name={dept.icon} theme={theme} set={set} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>{dept.title}</Text>
        {dept.sub ? <Text style={{ color: theme.mute, fontSize: 10.5, marginTop: 1 }}>{dept.sub}</Text> : null}
      </View>
      <AppIcon name="chevron-right" size={18} color={theme.mute} />
    </Pressable>
  );
}

export function DeptDivider({ theme }: { theme: any }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />;
}

export function DeptBack({ theme, label, onPress }: { theme: any; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, alignSelf: "flex-start" }}
      accessibilityLabel={label}
    >
      <AppIcon name="arrow-left" size={18} color={theme.accentHi} />
      <Text style={{ color: theme.accentHi, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
