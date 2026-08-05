/**
 * EmptyState — пустое состояние экрана: иконка + заголовок + текст + CTA.
 */
import React from "react";
import { Text, View, ViewStyle } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../../store/AppStore";
import { Button } from "./Button";
import { IconName } from "./IconButton";

export function EmptyState({
  icon = "inbox",
  title,
  subtitle,
  cta,
  onCta,
  style,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  cta?: string;
  onCta?: () => void;
  style?: ViewStyle;
}) {
  const { theme } = useApp();
  return (
    <View style={[{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }, style]}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          backgroundColor: theme.accentDim,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <MaterialIcons name={icon} size={28} color={theme.accentHi} />
      </View>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700", marginBottom: 6, textAlign: "center" }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: theme.dim, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
          {subtitle}
        </Text>
      ) : null}
      {cta && onCta ? (
        <View style={{ marginTop: 18, maxWidth: 260, alignSelf: "center" }}>
          <Button title={cta} onPress={onCta} fullWidth />
        </View>
      ) : null}
    </View>
  );
}
