/**
 * Настройки — корень-список из 9 отделов-подокон (никаких простыней).
 *
 * Отделы: Аккаунт / Агент / Внешний вид / Голос / Память /
 * Безопасность / Делегация / Данные / О приложении.
 * Корень — только список со стрелками и значками (Dept),
 * внутри каждого — свои контролы.
 *
 * Пресеты агента — локальный стор (AsyncStorage).
 * NATIVE OWNER (Арес): движок agent-config (max_turns, approvals,
 * compression, STT/TTS, memory, security, delegation, toolsets) —
 * заменить PREFS/loadPrefs/savePref на вызовы движка, UI не менять.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { DeptRow, DeptDivider, DeptBack, DeptDef } from "../components/Dept";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useApp } from "../store/AppStore";
import { ThemeName, fonts } from "../theme/tokens";
import { Lang } from "../i18n";
import { TextField, PrimaryButton } from "../components/ui";
import { requestSync, pollSync, fetchProfile } from "../core/sync";
import { exportBackupToFile, importBackupFromFile } from "../core/backup";
import { config, setApiBase } from "../core/env";
import { showToast } from "../design-system/components/Toast";
import { Button } from "../design-system/components/Button";
import { Chip } from "../design-system/components/Chip";

// ключи хранилища (дублируют AppStore — чтобы не тянуть внутренности)
const KEYS_SESSIONS = "aso_sessions";
const KEYS_TOKEN = "aso_token";
const KEYS_DEVICE = "aso_device";
const KEYS_TMP = ["aso_theme", "aso_lang", "aso_sessions", "aso_active", "vibe:projects"];

// ── Пресеты агента (UI Hermes-паритета, локальный стор).
// NATIVE OWNER (Арес): движок agent-config — заменить на вызовы движка.
const PREFS = {
  maxTurns: "aso_agent_max_turns",
  approvals: "aso_approvals_mode",
  compression: "aso_compression",
  sttEnabled: "aso_stt_enabled",
  sttProvider: "aso_stt_provider",
  ttsProvider: "aso_tts_provider",
  memoryEnabled: "aso_memory_enabled",
  redactSecrets: "aso_redact_secrets",
  delegationMax: "aso_delegation_max",
};
const PREF_DEFAULTS = {
  maxTurns: "90",
  approvals: "smart",
  compression: "1",
  sttEnabled: "0",
  sttProvider: "local",
  ttsProvider: "edge",
  memoryEnabled: "1",
  redactSecrets: "1",
  delegationMax: "3",
};
async function loadPrefs(): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...PREF_DEFAULTS };
  try {
    for (const name of Object.keys(PREFS)) {
      const v = await AsyncStorage.getItem((PREFS as any)[name]);
      if (v !== null && v !== undefined) out[name] = v;
    }
  } catch {}
  return out;
}
async function savePref(name: string, value: string) {
  try { await AsyncStorage.setItem((PREFS as any)[name], value); } catch {}
}

type DeptKey = "account" | "agent" | "appearance" | "voice" | "memory" | "security" | "delegation" | "data" | "about";

export function SettingsScreen({ navigation }: { navigation: any }) {
  const { state, theme, dispatch, t } = useApp();
  const insets = useSafeAreaInsets();

  const [dept, setDept] = useState<DeptKey | null>(null);
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

  // пресеты агента (локальный стор до движка agent-config)
  const [prefs, setPrefs] = useState<Record<string, string>>(PREF_DEFAULTS);
  useEffect(() => { void loadPrefs().then(setPrefs); }, []);
  const setPref = useCallback((name: string, value: string) => {
    setPrefs((p) => ({ ...p, [name]: value }));
    void savePref(name, value);
  }, []);

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
    const res = await exportBackupToFile();
    if (res.ok) showToast("ok", res.message);
    else showToast("err", res.message);
  }, []);

  const importData = useCallback(async () => {
    const res = await importBackupFromFile();
    if (res.ok) {
      showToast("ok", res.message);
      // перечитываем всё из хранилища — максимально просто: полный рестарт состояния
      setTimeout(() => {
        if (globalThis.location) globalThis.location.reload();
      }, 800);
    } else {
      showToast("err", res.message);
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

  const depts: (DeptDef & { key: DeptKey })[] = [
    { key: "account", title: t("grp_acc"), sub: isSynced ? `@${state.profile?.username}` : t("not_connected"), icon: "send" },
    { key: "agent", title: t("grp_agent"), sub: `max_turns ${prefs.maxTurns} · ${prefs.approvals}`, icon: "bolt" },
    { key: "appearance", title: t("grp_appearance"), sub: `${state.theme} · ${state.lang}`, icon: "eye" },
    { key: "voice", title: t("grp_voice"), sub: `${prefs.sttProvider} · ${prefs.ttsProvider}`, icon: "mic" },
    { key: "memory", title: t("grp_memory"), sub: prefs.memoryEnabled === "1" ? t("connected") : t("not_connected"), icon: "bulb" },
    { key: "security", title: t("grp_security"), sub: prefs.redactSecrets === "1" ? t("connected") : t("not_connected"), icon: "check-circle" },
    { key: "delegation", title: t("grp_delegation"), sub: `max ${prefs.delegationMax}`, icon: "group" },
    { key: "data", title: t("grp_data"), sub: t("subscription"), icon: "box" },
    { key: "about", title: "О приложении", sub: "1.5.0", icon: "info" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ color: theme.dim, fontSize: 11 }}>{t("settings_sub")}</Text>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.3 }}>{t("settings_title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {/* корень — только список отделов со стрелками */}
        {dept === null && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            {depts.map((d, i) => (
              <View key={d.key}>
                {i > 0 && <DeptDivider theme={theme} />}
                <DeptRow dept={d} theme={theme} onPress={() => setDept(d.key)} />
              </View>
            ))}
          </View>
        )}

        {dept !== null && (
          <DeptBack theme={theme} label={t("back")} onPress={() => setDept(null)} />
        )}

        {/* ── Аккаунт и синхронизация ── */}
        {dept === "account" && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.onAccent, fontSize: 16, fontWeight: "700" }}>{state.profile?.username?.slice(0, 2).toUpperCase() || "A"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
                  {state.profile?.username || "Не синхронизировано"}
                </Text>
                <Text style={{ color: theme.mute, fontSize: 11, fontFamily: fonts.mono, marginTop: 2 }}>
                  {state.profile?.telegramId ? `tg_id ${state.profile.telegramId}` : "—"}
                </Text>
              </View>
              {state.profile?.premium && (
                <Text style={{ color: theme.warn, fontSize: 9, letterSpacing: 1, borderWidth: 1, borderColor: theme.warn + "66", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 }}>PREMIUM</Text>
              )}
            </View>

            {state.profile && (
              <View style={{ marginTop: 12, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ color: theme.dim, fontSize: 12 }}>{t("daily_limit")}</Text>
                  <Text style={{ color: theme.text, fontSize: 12, fontFamily: fonts.mono }}>
                    {state.profile.quotaUsed.toLocaleString()} / {state.profile.quotaLimit.toLocaleString()} wt
                  </Text>
                </View>
                <View style={{ height: 7, borderRadius: 99, backgroundColor: theme.surface2, overflow: "hidden" }}>
                  <View style={{ width: `${quotaPct}%`, height: 7, borderRadius: 99, backgroundColor: theme.accent }} />
                </View>
              </View>
            )}

            <View style={{ marginTop: 12, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.warn + "55", backgroundColor: theme.warn + "12" }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.warn }} />
                        <Text style={{ color: theme.warn, fontSize: 11 }}>{t("sync_pending")}</Text>
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
          </>
        )}

        {/* ── Агент (Hermes: max_turns, approvals, compression) ── */}
        {dept === "agent" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>{t("agent_max_turns")}: {prefs.maxTurns}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["30", "90", "200"] as const).map((v) => (
                  <Chip key={v} label={v} active={prefs.maxTurns === v} onPress={() => setPref("maxTurns", v)} />
                ))}
              </View>
            </View>
            <DeptDivider theme={theme} />
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>{t("approvals_mode")}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["smart", "manual", "off"] as const).map((v) => (
                  <Chip
                    key={v}
                    label={v === "smart" ? t("approvals_smart") : v === "manual" ? t("approvals_manual") : t("approvals_off")}
                    active={prefs.approvals === v}
                    onPress={() => setPref("approvals", v)}
                  />
                ))}
              </View>
            </View>
            <DeptDivider theme={theme} />
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.surface, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{t("compression")}</Text>
              <Switch
                value={prefs.compression === "1"}
                onValueChange={(v) => setPref("compression", v ? "1" : "0")}
                trackColor={{ false: theme.surface2, true: theme.accent }}
                thumbColor={prefs.compression === "1" ? "#fff" : theme.mute}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>
        )}

        {/* ── Внешний вид ── */}
        {dept === "appearance" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>Тема</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["light", "dark", "system"] as const).map((th) => (
                  <Chip key={th} label={th === "light" ? "Светлая" : th === "dark" ? "Тёмная" : "Система"} active={state.theme === th} onPress={() => setTheme(th)} />
                ))}
              </View>
            </View>
            <DeptDivider theme={theme} />
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>Язык</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Chip label="RU" active={state.lang === "ru"} onPress={() => setLang("ru")} />
                <Chip label="EN" active={state.lang === "en"} onPress={() => setLang("en")} />
              </View>
            </View>
          </View>
        )}

        {/* ── Голос (Hermes stt/tts) ── */}
        {dept === "voice" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.surface, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{t("stt_enabled")}</Text>
              <Switch
                value={prefs.sttEnabled === "1"}
                onValueChange={(v) => setPref("sttEnabled", v ? "1" : "0")}
                trackColor={{ false: theme.surface2, true: theme.accent }}
                thumbColor={prefs.sttEnabled === "1" ? "#fff" : theme.mute}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
            <DeptDivider theme={theme} />
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>{t("stt_provider")}: {prefs.sttProvider}</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {(["local", "groq", "openai", "mistral"] as const).map((v) => (
                  <Chip key={v} label={v} active={prefs.sttProvider === v} onPress={() => setPref("sttProvider", v)} />
                ))}
              </View>
            </View>
            <DeptDivider theme={theme} />
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>{t("tts_provider")}: {prefs.ttsProvider}</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {(["edge", "elevenlabs", "openai", "gemini"] as const).map((v) => (
                  <Chip key={v} label={v} active={prefs.ttsProvider === v} onPress={() => setPref("ttsProvider", v)} />
                ))}
              </View>
            </View>
          </View>
        )}

        {/* ── Память ── */}
        {dept === "memory" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.surface, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{t("memory_enabled")}</Text>
              <Switch
                value={prefs.memoryEnabled === "1"}
                onValueChange={(v) => setPref("memoryEnabled", v ? "1" : "0")}
                trackColor={{ false: theme.surface2, true: theme.accent }}
                thumbColor={prefs.memoryEnabled === "1" ? "#fff" : theme.mute}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
            <DeptDivider theme={theme} />
            <Row label="Агент: память, навыки, задачи" onPress={() => navigation.navigate("AgentSettings")} value="" theme={theme} />
          </View>
        )}

        {/* ── Безопасность ── */}
        {dept === "security" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.surface, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{t("redact_secrets")}</Text>
              <Switch
                value={prefs.redactSecrets === "1"}
                onValueChange={(v) => setPref("redactSecrets", v ? "1" : "0")}
                trackColor={{ false: theme.surface2, true: theme.accent }}
                thumbColor={prefs.redactSecrets === "1" ? "#fff" : theme.mute}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>
        )}

        {/* ── Делегация ── */}
        {dept === "delegation" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <View style={{ padding: 14, backgroundColor: theme.surface }}>
              <Text style={{ color: theme.text, fontSize: 13.5, marginBottom: 8 }}>{t("delegation_max")}: {prefs.delegationMax}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["1", "3", "5"] as const).map((v) => (
                  <Chip key={v} label={v} active={prefs.delegationMax === v} onPress={() => setPref("delegationMax", v)} />
                ))}
              </View>
            </View>
            <DeptDivider theme={theme} />
            <Row label="Агент: автозадачи, куратор" onPress={() => navigation.navigate("AgentSettings")} value="" theme={theme} />
          </View>
        )}

        {/* ── Данные ── */}
        {dept === "data" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
            <Row label="Экспорт данных" onPress={exportData} value="" theme={theme} />
            <DeptDivider theme={theme} />
            <Row label="Импорт данных" onPress={importData} value="" theme={theme} />
            <DeptDivider theme={theme} />
            <Pressable
              onPress={wipeAll}
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ color: theme.danger, fontSize: 13.5, flex: 1 }}>Очистить все данные</Text>
              <AppIcon name="delete" size={18} color={theme.danger} />
            </Pressable>
          </View>
        )}

        {/* ── О приложении ── */}
        {dept === "about" && (
          <View style={{ borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, padding: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: theme.text, fontSize: 13.5 }}>Версия</Text>
              <Text style={{ color: theme.dim, fontSize: 13, fontFamily: fonts.mono }}>1.5.0</Text>
            </View>
            <View style={{ height: 8 }} />
            <Text style={{ color: theme.dim, fontSize: 12.5, lineHeight: 18 }}>
              Aso-z — мобильный AI-ассистент. Код открыт на GitHub. Возникла проблема? Скажи в чате поддержке.
            </Text>
            <View style={{ height: 10 }} />
            <Text style={{ color: theme.dim, fontSize: 11, lineHeight: 16 }}>
              Встроенный Linux-рантайм основан на компонентах проекта Termux (GPLv3): bootstrap, bash, coreutils, apt, dpkg. Исходный код: github.com/termux/termux-packages. Рантайм исполняет готовые бинарники Termux как отдельные процессы и не модифицирует их код.
            </Text>
          </View>
        )}
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
      <Text style={{ color: theme.accentHi, fontSize: 12, fontFamily: fonts.mono }}>{value}</Text>
      <AppIcon name="chevron-right" size={18} color={theme.mute} />
    </Pressable>
  );
}
