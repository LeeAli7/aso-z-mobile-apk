/**
 * Toast — всплывающие уведомления вместо Alert.alert.
 * Обёртка react-native-toast-message. Вызов: showToast('ok'|'err'|'info', text).
 */
import React from "react";
import { Text, View } from "react-native";
import Toast, { BaseToastProps } from "react-native-toast-message";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../../store/AppStore";

type Kind = "ok" | "err" | "info";

function ToastBody({ kind, text }: { kind: Kind; text: string }) {
  const { theme } = useApp();
  const icon = kind === "ok" ? "check-circle" : kind === "err" ? "error-outline" : "info-outline";
  const color = kind === "ok" ? theme.ok : kind === "err" ? theme.danger : theme.accentHi;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        maxWidth: "92%",
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <MaterialIcons name={icon as any} size={20} color={color} />
      <Text style={{ color: theme.text, fontSize: 13.5, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

export function ToastHost() {
  const { theme } = useApp();
  return (
    <Toast
      config={{
        ok: (p: BaseToastProps) => <ToastBody kind="ok" text={String(p.text1 ?? "")} />,
        err: (p: BaseToastProps) => <ToastBody kind="err" text={String(p.text1 ?? "")} />,
        info: (p: BaseToastProps) => <ToastBody kind="info" text={String(p.text1 ?? "")} />,
      }}
      visibilityTime={2800}
      autoHide
      topOffset={60}
      bottomOffset={80}
    />
  );
}

export function showToast(kind: Kind, text: string) {
  Toast.show({ type: kind, text1: text, position: "bottom" });
}
