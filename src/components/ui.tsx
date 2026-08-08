/**
 * Переиспользуемые UI-примитивы в стиле макета.
 */
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  ScrollView,
} from "react-native";
import { useApp } from "../store/AppStore";

/* ── Typography helpers ── */

export function useTypo() {
  const { theme } = useApp();
  return {
    title: { color: theme.text, fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
    hi: { color: theme.dim, fontSize: 11, letterSpacing: 0.6 },
    body: { color: theme.text, fontSize: 14, lineHeight: 20 },
    small: { color: theme.mute, fontSize: 11 },
    label: { color: theme.dim, fontSize: 12 },
    mono: { color: theme.text, fontSize: 12 },
  };
}

/* ── Row card ── */

export function Card({
  children,
  onPress,
  style,
  active,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  active?: boolean;
}) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 13,
          paddingVertical: 12,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: active ? theme.accent : theme.border,
          backgroundColor: active ? theme.accentDim : theme.surface,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ── Section header ── */

export function GroupLabel({ children }: { children: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <Text style={{ color: theme.mute, fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 8, marginBottom: 2, marginHorizontal: 4 }}>
      {children}
    </Text>
  );
}

/* ── Primary button ── */

export function PrimaryButton({
  title,
  onPress,
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 13,
          borderRadius: 18,
          backgroundColor: theme.accent,
          opacity: pressed ? 0.85 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: theme.name === "dark" ? "#1c1202" : "#fdf9f2", fontSize: 14.5, fontWeight: "600" }}>
        {title}
      </Text>
    </Pressable>
  );
}

/* ── Text field ── */

export function TextField({
  value,
  onChangeText,
  placeholder,
  style,
  multiline,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  style?: TextStyle;
  multiline?: boolean;
}) {
  const { theme } = useApp();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.mute}
      multiline={multiline}
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 18,
          paddingHorizontal: 13,
          paddingVertical: 10,
          fontSize: 14,
          color: theme.text,
          minHeight: 44,
        },
        style,
      ]}
    />
  );
}

/* ── Bottom sheet ── */

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { theme } = useApp();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: theme.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 14,
            paddingBottom: 28,
            paddingTop: 8,
            maxHeight: "80%",
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 4,
              borderRadius: 99,
              backgroundColor: theme.surface2,
              marginBottom: 10,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: theme.mute, fontSize: 16 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ── Toggle ── */

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{
        width: 40,
        height: 24,
        borderRadius: 99,
        backgroundColor: value ? theme.accent : theme.surface2,
        borderWidth: 1,
        borderColor: value ? theme.accent : theme.border,
        justifyContent: "center",
        paddingHorizontal: 2,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 99,
          backgroundColor: "#fff",
          alignSelf: value ? "flex-end" : "flex-start",
        }}
      />
    </Pressable>
  );
}

/* ── Cap badge ── */

export function CapBadge({ label, active }: { label: string; active: boolean }) {
  const { theme } = useApp();
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.border,
        backgroundColor: active ? theme.accentDim : "transparent",
      }}
    >
      <Text style={{ color: active ? theme.accent : theme.mute, fontSize: 9, fontFamily: "monospace" }}>
        {label}
      </Text>
    </View>
  );
}
