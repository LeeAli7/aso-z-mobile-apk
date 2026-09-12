/**
 * DrawerLineArt — боковое меню строго по макету «Вариант B — плоский».
 *
 * Правила из промпта:
 *  - кастомные inline SVG (react-native-svg), stroke 1.5-1.75, round, currentColor
 *  - шапка: синий текст «Новый чат» + синее перо слева (без синей плашки)
 *  - ровно 5 пунктов: Модель / Провайдеры / Агент / Проекты / Настройки
 *    («Хранилище» удалено — открывается через Проекты/StorageSheet чата)
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
import Svg, { Path, Circle, Line } from "react-native-svg";
import { ModelInfo } from "../core/gateway";
import { Session } from "../store/AppStore";
import { fonts } from "../theme/tokens";

const WIDTH = 300;
const HIDE = -WIDTH - 20;

/* ── LineArt: тонкий контур, единый стиль ── */

const SW = 1.6;

function LineIcon({ d, color, size = 20 }: { d: React.ReactNode; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </Svg>
  );
}

/** Новый чат — синее перо/редактирование. */
export function PenIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <>
        <Path d="M12 20h9" />
        <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    } />
  );
}

/** Модель — четырёхконечная звезда/искра (Sparkle). */
export function SparkleIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <Path d="M12 3c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8Z" />
    } />
  );
}

/** Провайдеры — горизонтальные слайдеры настройки. */
export function SlidersIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <>
        <Line x1="4" y1="7" x2="20" y2="7" />
        <Circle cx="15" cy="7" r="2.2" fill="#00000000" />
        <Line x1="4" y1="12" x2="20" y2="12" />
        <Circle cx="9" cy="12" r="2.2" fill="#00000000" />
        <Line x1="4" y1="17" x2="20" y2="17" />
        <Circle cx="16" cy="17" r="2.2" fill="#00000000" />
      </>
    } />
  );
}

/** Агент — аккуратная векторная шестерёнка. */
export function AgentIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <>
        <Circle cx="12" cy="12" r="3.2" />
        <Path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
      </>
    } />
  );
}

/** Проекты — лаконичный контур папки. */
export function FolderIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    } />
  );
}

/** Настройки — тонкая шестерёнка в едином стиле. */
export function SettingsIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <>
        <Circle cx="12" cy="12" r="3" />
        <Path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z" />
      </>
    } />
  );
}

/** Поиск — тонкая векторная лупа. */
export function SearchIcon({ color, size }: { color: string; size?: number }) {
  return (
    <LineIcon color={color} size={size} d={
      <>
        <Circle cx="11" cy="11" r="6.5" />
        <Line x1="16" y1="16" x2="20.5" y2="20.5" />
      </>
    } />
  );
}

export function EditPenIcon({ color, size }: { color: string; size?: number }) {
  return <PenIcon color={color} size={size} />;
}

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
              <PenIcon color={accent} size={19} />
              <Text style={{ color: accent, fontSize: 14, fontWeight: "600" }}>{t("newSession")}</Text>
            </Pressable>

            {/* ровно 5 пунктов */}
            <View style={{ marginTop: 4 }}>
              {row(
                <SparkleIcon color={modelsExpanded ? accent : iconColor} size={20} />,
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
                </View>
              )}
              {row(<SlidersIcon color={iconColor} size={20} />, t("providers"), undefined, () => onNavigate("Providers"))}
              {row(<AgentIcon color={iconColor} size={20} />, "Агент", undefined, () => onNavigate("AgentSettings"))}
              {row(<FolderIcon color={iconColor} size={20} />, t("vibe_title"), undefined, () => onNavigate("Vibe"))}
              {row(<SettingsIcon color={iconColor} size={20} />, t("settings_title"), undefined, () => onNavigate("Settings"))}
            </View>

            <View style={{ height: 1, backgroundColor: theme.border, opacity: 0.7, marginVertical: 10, marginHorizontal: 12 }} />

            {/* поиск: плоская строка без рамок */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44 }}>
              <SearchIcon color={theme.mute} size={20} />
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
                          <EditPenIcon color={theme.dim} size={16} />
                        </Pressable>
                        <Pressable onPress={() => onDelete(s.id)} hitSlop={10} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Удалить">
                          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
                            <Path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" />
                          </Svg>
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
