/**
 * DrawerLineArt — боковое меню строго по макету «Вариант B — плоский».
 *
 * Иконки — AppIcon (единый движок, геометрия LineArt 1:1, strokeWidth 1.5
 * для пиксель-в-пиксель с макетом): pen/cube/group/folder/gear/search/delete.
 * Своих SVG-дубликатов в файле нет.
 *
 *  - шапка: синий текст «Новый чат» + синее перо слева (без синей плашки)
 *  - пункты Hermes-паритета: Модель (куб) / Агенты (группа) / Хранилище (папка) /
 *    Коннекторы (link) / Доска (check) / Использование (trend) / Настройки (gear)
 *  - поиск: плоская строка с лупой, без рамок (border none, transparent)
 *  - сессии: плоский текстовый список, без карточек/рамок/дат,
 *    иконки правки только у активной строки
 *
 * Движок не тронут: колбэки (onNewChat/onSelectModel/onNavigate/...)
 * переиспользованы 1:1 из старого Drawer.
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
import { AppIcon } from "../design-system/components/AppIcon";
import { DeptIcon } from "../components/Dept";
import { ModelInfo } from "../core/gateway";
import { Session } from "../store/AppStore";
import { fonts } from "../theme/tokens";

const WIDTH = 300;
const HIDE = -WIDTH - 20;

/* Иконки — AppIcon (strokeWidth 1.5 = пиксель-в-пиксель с макетом B). */
const SW = 1.5;

/* ── Панель ── */

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

  // плоская строка меню: иконка + текст, без рамок и фонов
  const row = (icon: React.ReactNode, title: string, sub?: string, onPress?: () => void, active?: boolean) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        opacity: pressed ? 0.6 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={{ color: active ? theme.accentHi : theme.text, fontSize: 14, fontWeight: "500" }}>{title}</Text>
        {sub ? (
          <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10, marginTop: 1, fontFamily: fonts.mono }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  const iconColor = theme.dim;
  const accent = theme.accentHi;

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
            paddingTop: insets.top + 12,
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
            {/* шапка: синий текст + синее перо, без плашки */}
            <Pressable
              onPress={onNewChat}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={t("newSession")}
            >
              <AppIcon name="pen" color={accent} size={19} strokeWidth={SW} />
              <Text style={{ color: accent, fontSize: 14, fontWeight: "600" }}>{t("newSession")}</Text>
            </Pressable>

            {/* пункты Hermes-паритета: модель / агенты / хранилище / коннекторы / доска / использование / настройки */}
            <View style={{ marginTop: 4 }}>
              {row(
                <AppIcon name="cube" color={modelsExpanded ? accent : iconColor} size={20} strokeWidth={SW} />,
                modelName, t("model_select"),
                () => setModelsExpanded((v) => !v), modelsExpanded,
              )}
              {modelsExpanded && (
                <View style={{ marginLeft: 8 }}>
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
                          paddingVertical: 9,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <View style={{ width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, borderColor: on ? theme.accent : theme.border, alignItems: "center", justifyContent: "center" }}>
                          {on && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: on ? accent : theme.text, fontSize: 13, fontWeight: "600" }}>{m.displayName}</Text>
                          <Text style={{ color: theme.mute, fontSize: 9, marginTop: 1, fontFamily: fonts.mono }}>
                            {m.tier.toUpperCase()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {/* вход на Провайдеры — роут был без кнопки */}
                  <Pressable
                    onPress={() => onNavigate("Providers")}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      opacity: pressed ? 0.6 : 1,
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={t("providers")}
                  >
                    <DeptIcon name="link" theme={theme} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{t("providers")}</Text>
                      <Text style={{ color: theme.mute, fontSize: 9, marginTop: 1, fontFamily: fonts.mono }}>
                        {t("add_provider").toUpperCase()}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              )}
              {row(<DeptIcon name="group" theme={theme} />, "Агенты", undefined, () => onNavigate("AgentSettings"))}
              {row(<DeptIcon name="folder" theme={theme} />, t("vibe_title"), undefined, () => onNavigate("Vibe"))}
              {row(<DeptIcon name="link" theme={theme} />, t("connectors_title"), undefined, () => onNavigate("Connectors"))}
              {row(<DeptIcon name="check" theme={theme} />, t("kanban_title"), undefined, () => onNavigate("Kanban"))}
              {row(<DeptIcon name="trend" theme={theme} />, t("usage_title"), undefined, () => onNavigate("Usage"))}
              {row(<DeptIcon name="gear" theme={theme} />, t("settings_title"), undefined, () => onNavigate("Settings"))}
            </View>

            <View style={{ height: 1, backgroundColor: theme.border, opacity: 0.7, marginVertical: 10, marginHorizontal: 12 }} />

            {/* поиск: плоская строка без рамок */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44 }}>
              <AppIcon name="search" color={theme.mute} size={20} strokeWidth={SW} />
              <TextInput
                value={search}
                onChangeText={onSearchChange}
                placeholder="Поиск"
                placeholderTextColor={theme.mute}
                style={{ flex: 1, fontSize: 14, color: theme.text, paddingVertical: 4 }}
              />
            </View>

            {/* сессии: плоский текст, высокая плотность */}
            <View style={{ marginTop: 2 }}>
              {sessions.map((s) => {
                const on = s.id === activeId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onSelectSession(s.id)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text numberOfLines={1} style={{ flex: 1, color: on ? accent : theme.text, fontSize: 13.5, fontWeight: on ? "600" : "400" }}>
                      {s.name}
                    </Text>
                    {on && (
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Pressable onPress={() => onRename(s.id)} hitSlop={10} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Переименовать">
                          <AppIcon name="pen" color={theme.dim} size={16} strokeWidth={SW} />
                        </Pressable>
                        <Pressable onPress={() => onDelete(s.id)} hitSlop={10} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Удалить">
                          <AppIcon name="delete" color={theme.dim} size={16} strokeWidth={SW} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
