/**
 * ConnectorsScreen — коннекторы, корень-список из 3 отделов-подокон.
 *
 * Отделы: Мессенджеры / MCP-серверы / Вебхуки.
 * Корень — только список, внутри — контролы.
 *
 * NATIVE OWNER (Арес): движок connectors (platforms status, MCP
 * add/list/test/remove, webhooks) — заменить AsyncStorage-стор ниже
 * на вызовы движка, UI не менять.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";
import { Button } from "../design-system/components/Button";
import { DeptRow, DeptDivider, DeptBack, DeptDef } from "../components/Dept";

const KEY_MCP = "aso_mcp_servers";
const KEY_WH = "aso_webhooks";

interface Mcp { id: string; name: string; target: string }
interface Wh { id: string; name: string; events: string }

async function readJson<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

type DeptKey = "messengers" | "mcp" | "webhooks";

export function ConnectorsScreen({ navigation }: { navigation: any }) {
  const { state, theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const [dept, setDept] = useState<DeptKey | null>(null);
  const [mcp, setMcp] = useState<Mcp[]>([]);
  const [wh, setWh] = useState<Wh[]>([]);
  const [mcpDraft, setMcpDraft] = useState({ name: "", target: "" });
  const [whDraft, setWhDraft] = useState({ name: "", events: "" });

  const load = useCallback(async () => {
    setMcp(await readJson<Mcp>(KEY_MCP));
    setWh(await readJson<Wh>(KEY_WH));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const addMcp = useCallback(async () => {
    const name = mcpDraft.name.trim();
    const target = mcpDraft.target.trim();
    if (!name || !target) return;
    const next = [...mcp, { id: genId(), name, target }];
    await AsyncStorage.setItem(KEY_MCP, JSON.stringify(next));
    setMcp(next);
    setMcpDraft({ name: "", target: "" });
  }, [mcp, mcpDraft]);

  const delMcp = useCallback(async (id: string) => {
    const next = mcp.filter((m) => m.id !== id);
    await AsyncStorage.setItem(KEY_MCP, JSON.stringify(next));
    setMcp(next);
  }, [mcp]);

  const addWh = useCallback(async () => {
    const name = whDraft.name.trim();
    if (!name) return;
    const next = [...wh, { id: genId(), name, events: whDraft.events.trim() }];
    await AsyncStorage.setItem(KEY_WH, JSON.stringify(next));
    setWh(next);
    setWhDraft({ name: "", events: "" });
  }, [wh, whDraft]);

  const delWh = useCallback(async (id: string) => {
    const next = wh.filter((w) => w.id !== id);
    await AsyncStorage.setItem(KEY_WH, JSON.stringify(next));
    setWh(next);
  }, [wh]);

  const input = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    backgroundColor: theme.surface2, color: theme.text, fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 9,
  };
  const synced = !!state.token && !!state.profile;
  const tgName = state.profile?.username ? `@${state.profile.username}` : "—";

  const depts: (DeptDef & { key: DeptKey })[] = [
    { key: "messengers", title: t("dept_messengers"), sub: synced ? tgName : t("not_connected"), icon: "send" },
    { key: "mcp", title: t("conn_mcp"), sub: `${mcp.length}`, icon: "box" },
    { key: "webhooks", title: t("conn_webhooks"), sub: `${wh.length}`, icon: "link" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginRight: 10 }} accessibilityLabel={t("back")}>
          <AppIcon name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View>
          <Text style={{ color: theme.dim, fontSize: 11 }}>{t("connectors_sub")}</Text>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>{t("connectors_title")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {/* корень — только список отделов */}
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

        {/* ── Мессенджеры ── */}
        {dept === "messengers" && (
          <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: synced ? theme.ok : theme.mute }} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 13.5, fontWeight: "600" }}>Telegram</Text>
              <Text style={{ color: synced ? theme.ok : theme.mute, fontSize: 11.5 }}>{synced ? `${t("connected")} · ${tgName}` : t("not_connected")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.mute }} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 13.5, fontWeight: "600" }}>Discord</Text>
              <Text style={{ color: theme.mute, fontSize: 11.5 }}>{t("soon")}</Text>
            </View>
          </View>
        )}

        {/* ── MCP-серверы ── */}
        {dept === "mcp" && (
          <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            {mcp.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 8 }}>Серверов нет — добавь команду (npx/uvx) или HTTP URL.</Text>
            ) : mcp.map((m) => (
              <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 }}>
                <AppIcon name="box" size={17} color={theme.accentHi} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{m.name}</Text>
                  <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, fontFamily: fonts.mono }}>{m.target}</Text>
                </View>
                <Pressable onPress={() => delMcp(m.id)} hitSlop={8} style={{ padding: 4 }}>
                  <AppIcon name="delete" size={17} color={theme.danger} />
                </Pressable>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
            <TextInput value={mcpDraft.name} onChangeText={(v) => setMcpDraft({ ...mcpDraft, name: v })} placeholder={t("mcp_name_ph")} placeholderTextColor={theme.mute} autoCapitalize="none" style={input} />
            <View style={{ height: 6 }} />
            <TextInput value={mcpDraft.target} onChangeText={(v) => setMcpDraft({ ...mcpDraft, target: v })} placeholder={t("mcp_cmd_ph")} placeholderTextColor={theme.mute} autoCapitalize="none" style={[input, { fontFamily: fonts.mono }]} />
            <View style={{ height: 8 }} />
            <Button title={t("create")} variant="primary" onPress={addMcp} disabled={!mcpDraft.name.trim() || !mcpDraft.target.trim()} />
          </View>
        )}

        {/* ── Вебхуки ── */}
        {dept === "webhooks" && (
          <View style={{ padding: 14, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            {wh.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 12.5, marginBottom: 8 }}>Подписок нет — POST от внешнего сервиса разбудит агента.</Text>
            ) : wh.map((w) => (
              <View key={w.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 }}>
                <AppIcon name="link" size={17} color={theme.accentHi} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>{w.name}</Text>
                  {w.events ? <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10.5, fontFamily: fonts.mono }}>{w.events}</Text> : null}
                </View>
                <Pressable onPress={() => delWh(w.id)} hitSlop={8} style={{ padding: 4 }}>
                  <AppIcon name="delete" size={17} color={theme.danger} />
                </Pressable>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />
            <TextInput value={whDraft.name} onChangeText={(v) => setWhDraft({ ...whDraft, name: v })} placeholder={t("mcp_name_ph")} placeholderTextColor={theme.mute} autoCapitalize="none" style={input} />
            <View style={{ height: 6 }} />
            <TextInput value={whDraft.events} onChangeText={(v) => setWhDraft({ ...whDraft, events: v })} placeholder={t("wh_events_ph")} placeholderTextColor={theme.mute} autoCapitalize="none" style={[input, { fontFamily: fonts.mono }]} />
            <View style={{ height: 8 }} />
            <Button title={t("create")} variant="primary" onPress={addWh} disabled={!whDraft.name.trim()} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
