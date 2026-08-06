/**
 * Настройки: профиль, синхронизация с Telegram (по username),
 * тема (светлая/тёмная/системная), язык, подписка/лимиты.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useApp } from "../store/AppStore";
import { ThemeName } from "../theme/tokens";
import { Lang } from "../i18n";
import { TextField, PrimaryButton, GroupLabel } from "../components/ui";
import { requestSync, pollSync, fetchProfile } from "../core/sync";
import { config, setApiBase } from "../core/env";
import { showToast } from "../design-system/components/Toast";
import { Button } from "../design-system/components/Button";
import { Chip } from "../design-system/components/Chip";

// ключи хранилища (дублируют AppStore — чтобы не тянуть внутренности)
const KEYS_SESSIONS = "aso_sessions";
const KEYS_TOKEN = "aso_token";
const KEYS_DEVICE = "aso_device";
const KEYS_TMP = ["aso_theme", "aso_lang", "aso_sessions", "aso_active", "vibe:projects"];

export function SettingsScreen({ navigation }: { navigation: any }) {
  const { state, theme, dispatch, t } = useApp();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState("");
  const [server, setServer] = useState(config.apiBase);
  const [status, setStatus] = useState(state.syncStatus);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSynced = !!state.token && !!state.profile;

  const doSync = useCallback(async () => {
    const uname = username.trim().replace(/^@/, "");
    if (!uname) return;
    // сброс предыдущего опроса (гонки при повторной отправке)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setSyncing(true);
    setStatus("pending");
    dispatch({ type: "SET_SYNC", status: "pending", syncing: true });
    try {
      await requestSync(uname, state.deviceId);
      // таймаут ожидания подтверждения: 120 секунд
      const deadline = Date.now() + 120_000;
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          dispatch({ type: "SET_SYNC", status: "error", syncing: false });
          setStatus("error");
          setSyncing(false);
          showToast("err", "Время ожидания истекло. Подтверди запрос в боте и попробуй снова.");
          return;
        }
        try {
          const res = await pollSync(state.deviceId);
          if (res.status === "approved" && res.token) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            dispatch({ type: "SET_TOKEN", token: res.token });
            dispatch({ type: "SET_SYNC", status: "done", syncing: false });
            const profile = await fetchProfile(res.token);
            dispatch({
              type: "SET_PROFILE",
              profile: {
                username: profile.username ?? uname,
                telegramId: profile.telegram_id ?? null,
                premium: !!profile.premium,
                quotaUsed: profile.quota?.used ?? 0,
                quotaLimit: profile.quota?.limit ?? 0,
              },
            });
            setStatus("done");
            setSyncing(false);
            showToast("ok", "Аккаунт синхронизирован");
          } else if (res.status === "denied") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            dispatch({ type: "SET_SYNC", status: "error", syncing: false });
            setStatus("error");
            setSyncing(false);
            showToast("err", "Запрос отклонён в боте");
          }
        } catch {}
      }, 3000);
    } catch (e: any) {
      dispatch({ type: "SET_SYNC", status: "error", syncing: false });
      setStatus("error");
      setSyncing(false);
      showToast("err", String(e?.message || e));
    }
  }, [username, state.deviceId, dispatch, t]);

  const cancelSync = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    dispatch({ type: "SET_SYNC", status: "idle", syncing: false });
    setStatus("idle");
    setSyncing(false);
  }, [dispatch]);

  useEffect(() => {
    // если уже есть токен — подтянуть профиль
    if (state.token && !state.profile) {
      fetchProfile(state.token)
        .then((p) => dispatch({ type: "SET_PROFILE", profile: {
          username: p.username, telegramId: p.telegram_id, premium: !!p.premium,
          quotaUsed: p.quota?.used ?? 0, quotaLimit: p.quota?.limit ?? 0,
        }}))
        .catch(() => {});
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state.token, state.profile, dispatch]);

  const setTheme = (th: ThemeName) => dispatch({ type: "SET_THEME", theme: th });
  const setLang = (l: Lang) => dispatch({ type: "SET_LANG", lang: l });

  const logout = useCallback(() => {
    Alert.alert(t("settings_title"), "Выйти из аккаунта?", [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"), style: "destructive",
        onPress: () => {
          dispatch({ type: "SET_TOKEN", token: null });
          dispatch({ type: "SET_PROFILE", profile: null });
          dispatch({ type: "SET_SYNC", status: "idle", syncing: false });
          setStatus("idle");
        },
      },
    ]);
  }, [dispatch, t]);

  const exportData = useCallback(async () => {
    try {
      const sessionsRaw = await AsyncStorage.getItem(KEYS_SESSIONS).catch(() => null);
      const text = `# Aso-z — экспорт данных\n\n${new Date().toISOString()}\n\n## Сессии\n\n${sessionsRaw ?? "[]"}\n`;
      await Share.share({ message: text }).catch(() => {});
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    }
  }, []);

  const wipeAll = useCallback(() => {
    Alert.alert("Очистить всё", "Удалятся все сессии, чаты, проекты и файлы. Это нельзя отменить.", [
      { text: t("cancel"), style: "cancel" },
      {
        text: "Очистить", style: "destructive",
        onPress: async () => {
          try {
            for (const k of KEYS_TMP) await AsyncStorage.removeItem(k);
            await SecureStore.deleteItemAsync(KEYS_TOKEN);
            await SecureStore.deleteItemAsync(KEYS_DEVICE);
            await SecureStore.deleteItemAsync("aso_custom_providers");
            const { Directory, Paths } = require("expo-file-system");
            const vibe = new Directory(Paths.document, "vibe");
            if (vibe.exists) vibe.delete();
            dispatch({ type: "SET_SESSIONS", sessions: [] });
            dispatch({ type: "SET_ACTIVE", sessionId: null });
            dispatch({ type: "SET_TOKEN", token: null });
            dispatch({ type: "SET_PROFILE", profile: null });
            showToast("ok", "Все данные очищены");
          } catch (e: any) {
            showToast("err", String(e?.message || e));
          }
        },
      },
    ]);
  }, [dispatch, t]);

  const quotaPct = state.profile?.quotaLimit
    ? Math.min(100, Math.round((state.profile.quotaUsed / state.profile.quotaLimit) * 100))
    : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ color: theme.dim, fontSize: 11 }}>{t("settings_sub")}</Text>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.3 }}>{t("settings_title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {/* profile */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#1c1202", fontSize: 16, fontWeight: "700" }}>{state.profile?.username?.slice(0, 2).toUpperCase() || "A"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
              {state.profile?.username || "Не синхронизировано"}
            </Text>
            <Text style={{ color: theme.mute, fontSize: 11, fontFamily: "monospace", marginTop: 2 }}>
              {state.profile?.telegramId ? `tg_id ${state.profile.telegramId}` : "—"}
            </Text>
          </View>
          {state.profile?.premium && (
            <Text style={{ color: "#fbbf24", fontSize: 9, letterSpacing: 1, borderWidth: 1, borderColor: "rgba(251,191,36,.4)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 }}>PREMIUM</Text>
          )}
        </View>

        {/* quota */}
        {state.profile && (
          <View style={{ marginTop: 12, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: theme.dim, fontSize: 12 }}>{t("daily_limit")}</Text>
              <Text style={{ color: theme.text, fontSize: 12, fontFamily: "monospace" }}>
                {state.profile.quotaUsed.toLocaleString()} / {state.profile.quotaLimit.toLocaleString()} wt
              </Text>
            </View>
            <View style={{ height: 7, borderRadius: 99, backgroundColor: theme.surface2, overflow: "hidden" }}>
              <View style={{ width: `${quotaPct}%`, height: 7, borderRadius: 99, backgroundColor: theme.accent }} />
            </View>
          </View>
        )}

        {/* sync */}
        <GroupLabel>{t("sync_tg")}</GroupLabel>
        <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
          {isSynced ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: theme.ok, fontSize: 13 }}>●</Text>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>{t("sync_done")}</Text>
              </View>
              <Pressable onPress={logout}><Text style={{ color: theme.danger, fontSize: 13 }}>{t("delete")}</Text></Pressable>
            </View>
          ) : (
            <>
              <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 19, marginBottom: 10 }}>
                Введи username — бот @aiAsobot отправит запрос на подтверждение в личку. После подтверждения аккаунт и лимиты будут общие.
              </Text>
              <TextField value={username} onChangeText={setUsername} placeholder={t("sync_username_ph")} />
              <View style={{ height: 10 }} />
              <PrimaryButton title={t("sync_send")} onPress={doSync} disabled={syncing || !username.trim()} />
              {status === "pending" && (
                <View style={{ marginTop: 10, gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: "rgba(251,191,36,.3)", backgroundColor: "rgba(251,191,36,.07)" }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#fbbf24" }} />
                    <Text style={{ color: "#fbbf24", fontSize: 11 }}>{t("sync_pending")}</Text>
                  </View>
                  <Button title="Отменить" variant="ghost" onPress={cancelSync} />
                </View>
              )}
              {status === "error" && (
                <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{t("sync_error")} — проверь username</Text>
              )}
            </>
          )}
        </View>

        {/* app settings */}
        <GroupLabel>{t("grp_app")}</GroupLabel>
        <View style={{ marginTop: 4, borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
          <Row label="Провайдеры и модели" onPress={() => navigation.navigate("Providers")} value={`${state.models.length + state.customModels.length}`} theme={theme} />
          <Divider theme={theme} />
          <View style={{ padding: 14, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>Тема</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["light", "dark", "system"] as const).map((th) => (
                <Chip key={th} label={th === "light" ? "Светлая" : th === "dark" ? "Тёмная" : "Система"} active={state.theme === th} onPress={() => setTheme(th)} />
              ))}
            </View>
          </View>
          <Divider theme={theme} />
          <View style={{ padding: 14, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>Язык</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip label="RU" active={state.lang === "ru"} onPress={() => setLang("ru")} />
              <Chip label="EN" active={state.lang === "en"} onPress={() => setLang("en")} />
            </View>
          </View>
        </View>

        {/* data */}
        <GroupLabel>Данные</GroupLabel>
        <View style={{ marginTop: 4, borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
          <Row label="Экспорт данных" onPress={exportData} value="" theme={theme} />
          <Divider theme={theme} />
          <Pressable
            onPress={wipeAll}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={{ color: theme.danger, fontSize: 13.5, flex: 1 }}>Очистить все данные</Text>
            <MaterialIcons name="delete-sweep" size={18} color={theme.danger} />
          </Pressable>
        </View>

        {/* about */}
        <GroupLabel>О приложении</GroupLabel>
        <View style={{ marginTop: 4, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, padding: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: theme.text, fontSize: 13.5 }}>Версия</Text>
            <Text style={{ color: theme.dim, fontSize: 13, fontFamily: "monospace" }}>1.5.0</Text>
          </View>
          <View style={{ height: 8 }} />
          <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 18 }}>
            Aso-z — мобильный AI-ассистент. Код открыт на GitHub. Возникла проблема? Скажи в чате поддержке.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, onPress, value, theme }: { label: string; onPress: () => void; value: string; theme: any }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.ripple }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: "monospace" }}>{value}</Text>
      <MaterialIcons name="chevron-right" size={18} color={theme.mute} />
    </Pressable>
  );
}

function Divider({ theme }: { theme: any }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />;
}