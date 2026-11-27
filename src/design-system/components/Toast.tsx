/**
 * Toast — всплывающие уведомления.
 *
 * Ошибки показываются СВЕРХУ: короткое объяснение + код (429/401/NET…).
 * Ошибки инструментов сюда не попадают — они уходят модели и в интерфейсе
 * не появляются вовсе.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import Toast, { BaseToastProps } from "react-native-toast-message";
import { showErrorBanner } from "../../components/ErrorBanner";
import { AppIcon, AppIconName } from "./AppIcon";
import { useApp } from "../../store/AppStore";
import { classifyError, ErrorInfo } from "../../core/errors";

type Kind = "ok" | "err" | "info";

const TINT: Record<ErrorInfo["kind"], string> = {
  limit: "#E8A33D",
  quota: "#E8A33D",
  auth: "#FF3B30",
  net: "#7A9BFF",
  server: "#FF3B30",
  input: "#8A8A91",
  context: "#8A8A91",
  policy: "#8A8A91",
  unknown: "#8A8A91",
};

function ErrorCard({ raw }: { raw: string }) {
  const { theme } = useApp();
  const info = classifyError(raw);
  const tint = TINT[info.kind];
  const bar = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    bar.setValue(1);
    Animated.timing(bar, {
      toValue: 0,
      duration: 3800,
      useNativeDriver: true,
    }).start();
  }, [bar, raw]);

  return (
    <View
      style={{
        marginHorizontal: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 18,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.28,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 12, paddingTop: 11, paddingBottom: 12 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: tint + "1F",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
          }}
        >
          <AppIcon
            name={
              (info.kind === "net"
                ? "globe"
                : info.kind === "limit"
                  ? "clock"
                  : info.kind === "auth"
                    ? "shield"
                    : info.kind === "server"
                      ? "server"
                      : "info") as AppIconName
            }
            size={16}
            color={tint}
          />
        </View>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 18, fontWeight: "600" }} numberOfLines={1}>
            {info.title}
          </Text>
          <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 17, marginTop: 2 }} numberOfLines={2}>
            {info.detail}
          </Text>
        </View>

        <View
          style={{
            marginLeft: 10,
            paddingHorizontal: 7,
            height: 20,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: tint, fontSize: 11.5, fontWeight: "600", letterSpacing: 0.3 }}>{info.code}</Text>
        </View>
      </View>

      <Animated.View
        style={{
          height: 2,
          backgroundColor: tint,
          opacity: 0.5,
          transform: [{ scaleX: bar }],
          transformOrigin: "left",
        }}
      />
    </View>
  );
}

function ToastBody({ kind, text }: { kind: Kind; text: string }) {
  const { theme } = useApp();
  if (kind === "err") return <ErrorCard raw={text} />;
  const icon = kind === "ok" ? "check-circle" : "info";
  const color = kind === "ok" ? theme.ok : theme.accentHi;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 20,
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
      <AppIcon name={icon as AppIconName} size={20} color={color} />
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
      visibilityTime={kindDuration()}
      autoHide
      topOffset={52}
      bottomOffset={80}
    />
  );
}

/** Ошибке нужно больше времени, чем галочке. */
function kindDuration() {
  return 4000;
}

export function showToast(kind: Kind, text: string) {
  // Ошибки — это тревога: красный баннер сверху, а не плашка внизу.
  if (kind === "err") {
    showErrorBanner(text);
    return;
  }
  Toast.show({ type: kind, text1: text, position: "bottom", visibilityTime: 2400 });
}

/** Единая точка для ошибок: разбор, короткий текст, код. */
export function showError(raw: unknown) {
  showErrorBanner(String((raw as any)?.message ?? raw ?? ""));
}
