/**
 * Настройки: профиль, синхронизация с Telegram (по username),
 * тема (светлая/тёмная/системная), язык, подписка/лимиты.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../store/AppStore";
import { ThemeName } from "../theme/tokens";
import { Lang } from "../i18n";
import { TextField, PrimaryButton, GroupLabel, Toggle } from "../components/ui";
import { requestSync, pollSync, fetchProfile } from "../core/sync";
import { config, setApiBase } from "../core/env";

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
    setSyncing(true);
    setStatus("pending");
    dispatch({ type: "SET_SYNC", status: "pending", syncing: true });
    try {
      await requestSync(uname, state.deviceId);
      // poll until approved
      pollRef.current = setInterval(async () => {
        try {
          const res = await pollSync(state.deviceId);
          if (res.status === "approved" && res.token) {
            if (pollRef.current) clearInterval(pollRef.current);
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
          } else if (res.status === "denied") {
            if (pollRef.current) clearInterval(pollRef.current);
            dispatch({ type: "SET_SYNC", status: "error", syncing: false });
            setStatus("error");
            setSyncing(false);
          }
        } catch {}
      }, 3000);
    } catch (e: any) {
      dispatch({ type: "SET_SYNC", status: "error", syncing: false });
      setStatus("error");
      setSyncing(false);
      Alert.alert(t("sync_error"), String(e?.message || e));
    }
  }, [username, state.deviceId, dispatch, t]);

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
                <Text style={{ color: theme.ok, fontSize: 14 }}>✓</Text>
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
                <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: "rgba(251,191,36,.3)", backgroundColor: "rgba(251,191,36,.07)" }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#fbbf24" }} />
                  <Text style={{ color: "#fbbf24", fontSize: 11 }}>{t("sync_pending")}</Text>
                </View>
              )}
              {status === "error" && (
                <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{t("sync_error")} — проверь username</Text>
              )}
            </>
          )}
        </View>

        {/* server address (для синхронизации с ТГ) */}
        <GroupLabel>Сервер синхронизации</GroupLabel>
        <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.dim, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
            Адрес нашего API. Нужен только для синхронизации аккаунта с Telegram (кнопка выше). Чат и Vibe работают напрямую, без сервера.
          </Text>
          <TextField value={server} onChangeText={setServer} placeholder="http://127.0.0.1:8000" />
          <View style={{ height: 8 }} />
          <PrimaryButton
            title="Сохранить адрес"
            onPress={async () => {
              await setApiBase(server);
              Alert.alert("Готово", "Адрес сервера сохранён.");
            }}
            disabled={!server.trim()}
          />
        </View>

        {/* app settings */}
        <GroupLabel>{t("grp_app")}</GroupLabel>
        <View style={{ marginTop: 4, borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
          <Row label={t("language")} onPress={() => setLang(state.lang === "ru" ? "en" : "ru")} value={state.lang.toUpperCase()} theme={theme} />
          <Divider theme={theme} />
          <Row label={t("theme")} onPress={() => {}} value={theme.name === "dark" ? t("theme_dark") : t("theme_light")} theme={theme} />
          <Divider theme={theme} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{t("theme_dark")}</Text>
            <Toggle value={theme.name === "dark"} onChange={(v) => setTheme(v ? "dark" : "light")} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, onPress, value, theme }: { label: string; onPress: () => void; value: string; theme: any }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface }}>
      <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: "monospace" }}>{value}</Text>
      <Text style={{ color: theme.mute, fontSize: 13, marginLeft: 6 }}>›</Text>
    </Pressable>
  );
}

function Divider({ theme }: { theme: any }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />;
}