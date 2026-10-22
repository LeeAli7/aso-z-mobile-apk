/**
 * Панель приложения (бургер) в стиле КРОВЬ.
 *
 * Сверху — единственное главное действие: белая капсула «Новый чат».
 * Ниже — отделы приложения: Проекты, Агенты, Терминал, Коннекторы,
 * Хранилище, Настройки. Дальше поиск и список сессий.
 *
 * Никакого стекла, свечений и полупрозрачных слоёв: чёрный фон,
 * белые иконки, серый вторичный текст.
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
import { AppIcon, AppIconName } from "../design-system/components/AppIcon";
import { ModelInfo } from "../core/gateway";
import { Session } from "../store/AppStore";
import { fonts } from "../theme/tokens";

const WIDTH = 320;
const HIDE = -WIDTH - 20;
const ROW_H = 52;

/** Отделы приложения — по одному значку на отдел, без повторов. */
const DEPTS: { key: string; title: string; icon: AppIconName; route: string }[] = [
  { key: "projects", title: "Проекты", icon: "folder", route: "Vibe" },
  { key: "agents", title: "Агенты", icon: "account", route: "Agents" },
  { key: "terminal", title: "Терминал", icon: "terminal", route: "Terminal" },
  { key: "connectors", title: "Коннекторы", icon: "link", route: "Connectors" },
  { key: "storage", title: "Хранилище", icon: "box", route: "Storage" },
  { key: "settings", title: "Настройки", icon: "settings", route: "Settings" },
];

export function DrawerLineArt({
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
  sessions,
  activeId,
  onSelectSession,
  search,
  onSearchChange,
  onRename,
  onDelete,
  cronSessions = [],
  onSessionMenu,
  onPin,
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
  sessions: Session[];
  activeId?: string | null;
  onSelectSession: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  /** Сессии автозадач — отдельный раздел, не мешаются с ручными чатами. */
  cronSessions?: Session[];
  /** Долгое нажатие по сессии — мини-окно действий. */
  onSessionMenu?: (s: Session, point?: { x: number; y: number }) => void;
  onPin?: (s: Session) => void;
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
      duration: 220,
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
          duration: 260,
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

  const row = (icon: AppIconName, title: string, onPress: () => void, active?: boolean, sub?: string) => (
    <Pressable
      key={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        minHeight: ROW_H,
        paddingHorizontal: 22,
        opacity: pressed ? 0.55 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <AppIcon name={icon} color={active ? theme.text : theme.text} size={22} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500", letterSpacing: -0.2 }}>{title}</Text>
        {sub ? (
          <Text numberOfLines={1} style={{ color: theme.dim, fontSize: 11, marginTop: 2, fontFamily: fonts.mono }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible || leaving} transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.scrim, opacity: backdropOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, theme.name === "dark" ? 0.72 : 0.28] }) }}>
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
            backgroundColor: theme.bg,
            borderRightWidth: 1,
            borderRightColor: theme.border,
            paddingTop: insets.top + 18,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateX: slide }],
          }}
        >
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Главное действие — белая капсула. */}
            <Pressable
              onPress={onNewChat}
              style={({ pressed }) => ({
                marginHorizontal: 22,
                height: 50,
                borderRadius: 25,
                backgroundColor: pressed ? theme.accentHi : theme.accent,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              })}
              accessibilityRole="button"
              accessibilityLabel={t("newSession")}
            >
              <AppIcon name="plus" color={theme.onAccent} size={18} />
              <Text style={{ color: theme.onAccent, fontSize: 16, fontWeight: "600" }}>{t("newSession")}</Text>
            </Pressable>

            <View style={{ height: 26 }} />

            {DEPTS.map((d) => row(d.icon, d.title, () => onNavigate(d.route)))}

            {/* Модель — вторичная строка, без отдельной иконки отдела. */}
            <Pressable
              onPress={() => setModelsExpanded((v) => !v)}
              style={({ pressed }) => ({ minHeight: ROW_H, paddingHorizontal: 22, justifyContent: "center", opacity: pressed ? 0.55 : 1 })}
              accessibilityRole="button"
              accessibilityLabel={modelName}
            >
              <Text style={{ color: theme.dim, fontSize: 13 }}>{models.length ? "Модель · " + modelName : "Модель не выбрана"}</Text>
            </Pressable>
            {modelsExpanded && models.length === 0 && (
              <Text style={{ color: theme.mute, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 22, paddingBottom: 10 }}>
                Своих моделей нет. Добавьте её в Настройках → Провайдеры.
              </Text>
            )}
            {modelsExpanded &&
              models.map((m) => {
                const on = currentModelName === m.modelName;
                return (
                  <Pressable
                    key={m.modelName}
                    onPress={() => onSelectModel(m)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 22,
                      paddingVertical: 10,
                      opacity: pressed ? 0.55 : 1,
                    })}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? theme.text : "transparent" }} />
                    <Text style={{ flex: 1, color: on ? theme.text : theme.dim, fontSize: 15 }}>{m.displayName}</Text>
                  </Pressable>
                );
              })}

            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 14, marginHorizontal: 22 }} />

            {/* Поиск */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 22, paddingVertical: 10 }}>
              <AppIcon name="search" color={theme.dim} size={20} />
              <TextInput
                value={search}
                onChangeText={onSearchChange}
                placeholder="Поиск"
                placeholderTextColor={theme.dim}
                style={{ flex: 1, fontSize: 16, color: theme.text, paddingVertical: 4 }}
              />
            </View>

            {[
              { key: "chats", title: "", list: sessions },
              { key: "cron", title: "Кроны", list: cronSessions },
            ].map((section) => (
              <View key={section.key}>
                {!!section.title && !!section.list.length && (
                  <Text style={{ color: theme.mute, fontSize: 11.5, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 22, paddingTop: 16, paddingBottom: 4 }}>
                    {section.title}
                  </Text>
                )}
                {section.list.map((s) => {
                  const on = s.id === activeId;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => onSelectSession(s.id)}
                      // действия (переименовать / прикрепить / удалить) живут в
                      // мини-окне: держим строку — и открывается окно
                      onLongPress={(e: any) => {
                        const ne = e?.nativeEvent ?? {};
                        onSessionMenu?.(s, { x: ne.pageX ?? 0, y: ne.pageY ?? 0 });
                      }}
                      delayLongPress={320}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        minHeight: 44,
                        paddingHorizontal: 22,
                        opacity: pressed ? 0.55 : 1,
                      })}
                    >
                      {!!s.pinned && <AppIcon name="pin" color={theme.dim} size={14} />}
                      {!!s.cron && <AppIcon name="clock" color={theme.mute} size={14} />}
                      <Text numberOfLines={1} style={{ flex: 1, color: on ? theme.text : theme.dim, fontSize: 15.5, fontWeight: on ? "600" : "400" }}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
