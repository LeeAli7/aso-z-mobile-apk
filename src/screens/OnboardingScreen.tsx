/**
 * OnboardingScreen — первичный онбординг (5 слайдов) в стиле Kimi-тёмной.
 * Свёрстан по утверждённому макету (onboarding.html):
 *  0 · Приветствие        — эмблема, заголовок, карточка «зачем»
 *  1 · Доступ к файлам    — «Все файлы» (системный экран Android)
 *  2 · Оптимизация батареи — список «Оптимизация батареи»
 *  3 · Уведомления        — настройки уведомлений приложения
 *  4 · Финал              — чек + «Начать работу»
 * Анимации: слайд-переходы (fade + translateX 46px, bezier .22/.61/.36/1),
 * stagger-появление элементов, pop-чек на финале. Всё на Animated + useNativeDriver.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass } from "../design-system/components/Glass";
import { openStorageSettings, openBatterySettings, openNotificationSettings } from "../../modules/aso-runtime/src";

const EASE = Easing.bezier(0.22, 0.61, 0.36, 1);
const { width: SCREEN_W } = Dimensions.get("window");

// Стили объявлены ДО SLIDES: JSX в SLIDES ссылается на s.b — иначе TDZ-ошибка.
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d", overflow: "hidden" },
  bg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as ViewStyle,
  glow: { position: "absolute", borderRadius: 999 },
  glowTop: {
    top: -120,
    right: -110,
    width: 600,
    height: 380,
    backgroundColor: "rgba(26,136,255,.10)",
    transform: [{ scaleX: 1.2 }],
  },
  glowBottom: {
    bottom: -140,
    left: -120,
    width: 520,
    height: 340,
    backgroundColor: "rgba(77,166,255,.06)",
  },
  dots: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.5,
  },
  progress: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,.14)",
  },
  dotOn: { width: 22, backgroundColor: "#1a88ff" },
  stage: { flex: 1, position: "relative" },
  slide: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 26, paddingBottom: 12 } as ViewStyle,
  slideBody: { flex: 1, justifyContent: "center" },

  emblemWrap: { alignItems: "center", marginBottom: 26 },
  emblem: {
    width: 76,
    height: 76,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(26,136,255,.35)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  emblemInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.10)",
  },

  kicker: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#4da6ff",
    marginBottom: 12,
  },
  title: {
    textAlign: "center",
    fontSize: 27,
    fontWeight: "800",
    lineHeight: 33,
    letterSpacing: -0.4,
    color: "rgba(255,255,255,.88)",
    marginBottom: 14,
  },
  lead: {
    textAlign: "center",
    fontSize: 15.5,
    lineHeight: 24,
    color: "rgba(255,255,255,.56)",
    maxWidth: 320,
    alignSelf: "center",
  },
  b: { color: "rgba(255,255,255,.88)", fontWeight: "600" },

  why: { marginTop: 22, padding: 16, paddingHorizontal: 18 },
  whyRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  whyIco: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(26,136,255,.16)",
    borderWidth: 1,
    borderColor: "rgba(26,136,255,.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  whyT: { fontSize: 14.5, fontWeight: "600", lineHeight: 20, color: "rgba(255,255,255,.88)", marginBottom: 3 },
  whyD: { fontSize: 13.5, lineHeight: 20, color: "rgba(255,255,255,.56)" },

  settingsRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,.07)",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  settingsIco: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#26262a",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsText: { flex: 1, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,.56)" },
  settingsBold: { color: "rgba(255,255,255,.88)", fontWeight: "600" },
  settingsChev: { color: "rgba(255,255,255,.38)", fontSize: 16 },

  actions: { marginTop: 22, gap: 10 },
  btnPrimaryWrap: {
    borderRadius: 16,
    shadowColor: "#1a88ff",
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  btnPrimary: {
    minHeight: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.25)",
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnGhost: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { color: "rgba(255,255,255,.56)", fontSize: 15, fontWeight: "600" },
  btnPressed: { opacity: 0.85 },
});

interface SlideDef {
  kicker: string;
  title: string;
  lead: React.ReactNode;
  icon: string;
  why: { icon: string; t: string; d: string };
  settings?: { label: string; path: string };
  primary: { label: string; action: "next" | "files" | "battery" | "notifications" | "done" };
  ghost?: string;
  final?: boolean;
}

const SLIDES: SlideDef[] = [
  {
    kicker: "Aso-z",
    title: "Твой личный AI-агент\nв кармане",
    lead: (
      <>
        Живой помощник, который <Text style={s.b}>пишет код</Text>,{" "}
        <Text style={s.b}>работает с файлами</Text> и <Text style={s.b}>выполняет команды</Text> прямо на
        твоём телефоне — в настоящем Linux-терминале.
      </>
    ),
    icon: "center-focus-strong",
    why: {
      icon: "code",
      t: "Не просто чат — рабочий инструмент",
      d: "Скажи «поставь python», «открой проект», «напиши скрипт» — агент сделает это сам.",
    },
    primary: { label: "Начнём", action: "next" },
  },
  {
    kicker: "Разрешение 1 из 3",
    title: "Доступ ко всем файлам",
    lead: (
      <>
        Агент умеет работать <Text style={s.b}>за пределами песочницы</Text>: читать и сохранять файлы в
        любых папках — проекты, скачанное, документы.
      </>
    ),
    icon: "folder-open",
    why: {
      icon: "description",
      t: "Зачем это нужно?",
      d: "Создание и редактирование проектов, сохранение результатов работы, быстрый доступ к загрузкам.",
    },
    settings: { label: "«Все файлы»", path: "Настройки → Приложения → Aso-z" },
    primary: { label: "Разрешить доступ", action: "files" },
    ghost: "Пропустить",
  },
  {
    kicker: "Разрешение 2 из 3",
    title: "Работа без ограничений\nбатареи",
    lead: (
      <>
        Чтобы агент <Text style={s.b}>не засыпал в фоне</Text>: длинные задачи, автозапуск и фоновые
        процессы не должны обрываться системой.
      </>
    ),
    icon: "battery-charging-full",
    why: {
      icon: "bolt",
      t: "Зачем это нужно?",
      d: "Команды, которые работают минуты, продолжают идти, даже когда телефон заблокирован.",
    },
    settings: { label: "«Оптимизация батареи»", path: "Настройки → Батарея → Aso-z" },
    primary: { label: "Отключить ограничение", action: "battery" },
    ghost: "Пропустить",
  },
  {
    kicker: "Разрешение 3 из 3",
    title: "Уведомления\nо работе агента",
    lead: (
      <>
        Видеть, <Text style={s.b}>что делает агент</Text>: статус команды, итог задачи, напоминания — даже
        когда приложение свёрнуто.
      </>
    ),
    icon: "notifications",
    why: {
      icon: "info-outline",
      t: "Зачем это нужно?",
      d: "Ты не сидишь в приложении — а агент продолжает работать и сообщает результат.",
    },
    settings: { label: "«Уведомления»", path: "Настройки → Приложения → Aso-z" },
    primary: { label: "Включить уведомления", action: "notifications" },
    ghost: "Пропустить",
  },
  {
    kicker: "Готово",
    title: "Всё настроено!\nПогнали 🚀",
    lead: (
      <>
        Теперь попробуй что-нибудь — например: <Text style={s.b}>«покажи, что в моих файлах»</Text> или{" "}
        <Text style={s.b}>«напиши скрипт, который…»</Text>.
      </>
    ),
    icon: "check",
    why: { icon: "rocket-launch", t: "Всё готово", d: "Разрешения выданы — агент готов к работе." },
    primary: { label: "Начать работу", action: "done" },
    final: true,
  },
];

/** Один слайд: анимация перехода (fade + translateX) + stagger-появление контента. */
function Slide({
  def,
  index,
  progress,
  active,
  onPrimary,
  onGhost,
}: {
  def: SlideDef;
  index: number;
  progress: Animated.Value;
  active: boolean;
  onPrimary: () => void;
  onGhost: () => void;
}) {
  const anims = useRef<Animated.Value[]>([]);
  if (anims.current.length === 0) anims.current = [0, 1, 2, 3, 4, 5].map(() => new Animated.Value(0));
  const prevActive = useRef(false);

  useEffect(() => {
    if (active && !prevActive.current) {
      // stagger-появление: эмблема → кикер → заголовок → лид → карточка → кнопки
      const seq = anims.current.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 460, easing: EASE, useNativeDriver: true }),
      );
      Animated.stagger(70, seq).start();
    }
    prevActive.current = active;
  }, [active]);

  // сброс анимаций при уходе со слайда
  useEffect(() => {
    if (!active) anims.current.forEach((v) => v.setValue(0));
  }, [active]);

  const translateX = progress.interpolate({
    inputRange: [index - 1, index, index + 1],
    outputRange: [46, 0, -46],
    extrapolate: "clamp",
  });
  const opacity = progress.interpolate({
    inputRange: [index - 1, index, index + 1],
    outputRange: [0, 1, 0],
    extrapolate: "clamp",
  });

  const rise = (i: number) => ({
    opacity: anims.current[i],
    transform: [
      {
        translateY: anims.current[i].interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
    ],
  });

  return (
    <Animated.View
      pointerEvents={active ? "auto" : "none"}
      style={[s.slide, { opacity, transform: [{ translateX }] }]}
    >
      <View style={s.slideBody}>
        {/* эмблема */}
        <Animated.View style={[s.emblemWrap, rise(0)]}>
          <LinearGradient
            colors={["rgba(26,136,255,.24)", "rgba(26,136,255,.05)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.emblem}
          >
            <View style={s.emblemInner}>
              {def.final ? (
                <MaterialIcons name="check" size={46} color="#16c456" />
              ) : (
                <MaterialIcons name={def.icon as never} size={34} color="#fff" />
              )}
            </View>
          </LinearGradient>
        </Animated.View>

        {/* кикер */}
        <Animated.View style={rise(1)}>
          <Text style={s.kicker}>{def.kicker}</Text>
        </Animated.View>

        {/* заголовок */}
        <Animated.View style={rise(2)}>
          <Text style={s.title}>{def.title}</Text>
        </Animated.View>

        {/* лид */}
        <Animated.View style={rise(3)}>
          <Text style={s.lead}>{def.lead}</Text>
        </Animated.View>

        {/* карточка «зачем» + строка настроек */}
        <Animated.View style={rise(4)}>
          <Glass radius={20} blur={false} style={s.why}>
            <View style={s.whyRow}>
              <View style={s.whyIco}>
                <MaterialIcons name={def.why.icon as never} size={19} color="#4da6ff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.whyT}>{def.why.t}</Text>
                <Text style={s.whyD}>{def.why.d}</Text>
              </View>
            </View>
            {def.settings && (
              <View style={s.settingsRow}>
                <View style={s.settingsIco}>
                  <MaterialIcons name="settings" size={15} color="rgba(255,255,255,.38)" />
                </View>
                <Text style={s.settingsText}>
                  Пункт: <Text style={s.settingsBold}>{def.settings.label}</Text>
                  {"\n"}
                  {def.settings.path}
                </Text>
                <Text style={s.settingsChev}>›</Text>
              </View>
            )}
          </Glass>
        </Animated.View>

        {/* кнопки */}
        <Animated.View style={[s.actions, rise(5)]}>
          <Pressable
            onPress={onPrimary}
            android_ripple={{ color: "rgba(255,255,255,.15)" }}
            style={({ pressed }) => [s.btnPrimaryWrap, pressed && s.btnPressed]}
          >
            <LinearGradient
              colors={["#2b95ff", "#1a88ff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={s.btnPrimary}
            >
              <Text style={s.btnPrimaryText}>{def.primary.label}</Text>
              <MaterialIcons
                name={def.primary.action === "done" ? "arrow-forward" : "chevron-right"}
                size={22}
                color="#fff"
              />
            </LinearGradient>
          </Pressable>
          {def.ghost && (
            <Pressable
              onPress={onGhost}
              android_ripple={{ color: "rgba(255,255,255,.08)" }}
              style={({ pressed }) => [s.btnGhost, pressed && s.btnPressed]}
            >
              <Text style={s.btnGhostText}>{def.ghost}</Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [cur, setCur] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);

  const go = useCallback(
    (n: number) => {
      if (n < 0 || n >= SLIDES.length || n === cur || busy.current) return;
      busy.current = true;
      setCur(n);
      Animated.timing(progress, {
        toValue: n,
        duration: 420,
        easing: EASE,
        useNativeDriver: true,
      }).start(() => {
        busy.current = false;
      });
    },
    [cur, progress],
  );

  const handlePrimary = useCallback(async () => {
    const def = SLIDES[cur];
    switch (def.primary.action) {
      case "next":
        go(cur + 1);
        break;
      case "files":
        try {
          if (Platform.OS === "android" && (Platform.Version as number) < 30) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
            go(cur + 1);
          } else {
            const ok = await openStorageSettings();
            if (ok) go(cur + 1);
          }
        } catch {
          go(cur + 1);
        }
        break;
      case "battery": {
        const ok = await openBatterySettings();
        if (ok) go(cur + 1);
        break;
      }
      case "notifications": {
        const ok = await openNotificationSettings();
        if (ok) go(cur + 1);
        break;
      }
      case "done":
        await AsyncStorage.setItem("aso_onboarding_done", "1").catch(() => {});
        onDone();
        break;
    }
  }, [cur, go, onDone]);

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      {/* фон: едва заметные glow-пятна + точечный паттерн */}
      <View pointerEvents="none" style={s.bg}>
        <View style={[s.glow, s.glowTop]} />
        <View style={[s.glow, s.glowBottom]} />
        <View style={s.dots} />
      </View>

      {/* прогресс */}
      <View style={s.progress}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[s.dot, i === cur && s.dotOn]} />
        ))}
      </View>

      {/* слайды */}
      <View style={s.stage}>
        {SLIDES.map((def, i) => (
          <Slide
            key={i}
            def={def}
            index={i}
            progress={progress}
            active={i === cur}
            onPrimary={() => void handlePrimary()}
            onGhost={() => go(cur + 1)}
          />
        ))}
      </View>
    </View>
  );
}

