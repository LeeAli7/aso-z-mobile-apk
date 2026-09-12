/**
 * Drawer — плоская боковая панель (вариант B, минимализм).
 *
 * Сверху: «Новый чат» + плоский список без групп
 * (Модель-инлайн / Провайдеры / Агент / Проекты / Настройки / Хранилище),
 * дальше поиск и сессии. Три шита (сессии/модели/Storage) заменены этим.
 *
 * Движок не трогает: только навигация и выбор (колбэки из ChatScreen).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { ModelInfo } from "../core/gateway";
import { Session } from "../store/AppStore";
import { fonts } from "../theme/tokens";

const WIDTH = 300;
const HIDE = -WIDTH - 20;

export function Drawer({
  visible,
  onClose,
  theme,
  t,
  models,
  currentModelName,
  modelName,
  onSelectModel,
  onNewChat,
  onNavigate,
  onOpenStorage,
  activeProjectName,
  sessions,
  activeId,
  onSelectSession,
  search,
  onSearchChange,
  onRename,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  theme: any;
  t: (k: any) => string;
  models: ModelInfo[];
  currentModelName?: string | null;
  modelName: string;
  onSelectModel: (m: ModelInfo) => void;
  onNewChat: () => void;
  onNavigate: (route: string) => void;
  onOpenStorage: () => void;
  activeProjectName?: string | null;
  sessions: Session[];
  activeId?: string | null;
  onSelectSession: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(HIDE)).current;
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [modelsExpanded, setModelsExpanded] = useState(false);

  const animateClose = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    Animated.timing(slide, {
      toValue: HIDE,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      leavingRef.current = false;
      setLeaving(false);
      onClose();
    });
  }, [slide, onClose]);

  useEffect(() => {
    if (visible) {
      leavingRef.current = false;
      setLeaving(false);
      slide.stopAnimation();
      slide.setValue(HIDE);
      requestAnimationFrame(() => {
        Animated.timing(slide, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    } else if (!leavingRef.current) {
      slide.setValue(HIDE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropOpacity = slide.interpolate({
    inputRange: [HIDE, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const row = (icon: keyof typeof MaterialIcons.glyphMap, title: string, sub?: string, onPress?: () => void, active?: boolean) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? theme.accent : "transparent",
        backgroundColor: active ? theme.accentDim : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <MaterialIcons name={icon} size={19} color={active ? theme.accentHi : theme.dim} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "500" }}>{title}</Text>
        {sub ? (
          <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10, marginTop: 1, fontFamily: fonts.mono }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible || leaving} transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.scrim, opacity: backdropOpacity }}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} accessibilityLabel="Закрыть" />
        </Animated.View>
        <Animated.View
          pointerEvents={visible ? "auto" : "none"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: WIDTH,
            backgroundColor: theme.surface,
            borderRightWidth: 1,
            borderRightColor: theme.border,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateX: slide }],
            shadowColor: "#000",
            shadowOpacity: theme.name === "dark" ? 0.6 : 0.25,
            shadowRadius: 24,
            shadowOffset: { width: 8, height: 0 },
            elevation: 20,
          }}
        >
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12 }}>
            <Pressable
              onPress={onNewChat}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 12,
                borderRadius: 14,
                backgroundColor: theme.accent,
                opacity: pressed ? 0.8 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={t("newSession")}
            >
              <MaterialIcons name="add" size={17} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "600" }}>{t("newSession")}</Text>
            </Pressable>

            <View style={{ marginTop: 6 }}>
              {row("smart-toy", modelName, t("model_select"), () => setModelsExpanded((v) => !v), modelsExpanded)}
              {modelsExpanded && (
                <View style={{ gap: 2, marginTop: 2, marginLeft: 8 }}>
                  {models.map((m) => {
                    const on = currentModelName === m.modelName;
                    return (
                      <Pressable
                        key={m.modelName}
                        onPress={() => onSelectModel(m)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: on ? theme.accent : "transparent",
                          backgroundColor: on ? theme.accentDim : "transparent",
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: on ? theme.accent : theme.border, alignItems: "center", justifyContent: "center" }}>
                          {on && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent }} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{m.displayName}</Text>
                          <Text style={{ color: theme.mute, fontSize: 9, marginTop: 1, fontFamily: fonts.mono }}>
                            {m.tier.toUpperCase()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {row("cloud", t("providers"), undefined, () => onNavigate("Providers"))}
              {row("psychology", "Агент", undefined, () => onNavigate("AgentSettings"))}
              {row("folder", t("vibe_title"), activeProjectName ?? undefined, () => onNavigate("Vibe"))}
              {row("settings", t("settings_title"), undefined, () => onNavigate("Settings"))}
              {row("storage", "Хранилище", undefined, onOpenStorage)}
            </View>

            <View style={{ height: 1, backgroundColor: theme.border, opacity: 0.7, marginVertical: 10 }} />

            <TextInput
              value={search}
              onChangeText={onSearchChange}
              placeholder="Поиск сессий…"
              placeholderTextColor={theme.mute}
              style={{ backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: theme.text, minHeight: 44 }}
            />
            <View style={{ gap: 6, marginTop: 8 }}>
              {sessions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => onSelectSession(s.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    padding: 10,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: s.id === activeId ? theme.accent : theme.border,
                    backgroundColor: s.id === activeId ? theme.accentDim : "transparent",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13 }}>{s.name}</Text>
                    <Text style={{ color: theme.mute, fontSize: 10, marginTop: 2 }}>
                      {s.messages.length} · {new Date(s.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Pressable onPress={() => onRename(s.id)} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Переименовать">
                    <MaterialIcons name="edit" size={17} color={theme.dim} />
                  </Pressable>
                  <Pressable onPress={() => onDelete(s.id)} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Удалить">
                    <MaterialIcons name="delete-outline" size={18} color={theme.dim} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
