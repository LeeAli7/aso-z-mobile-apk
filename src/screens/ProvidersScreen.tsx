/**
 * Провайдеры — системные модели + свои endpoint'ы с API-ключами.
 * Свои провайдеры: имя, URL, ключ (SecureStore), модель, температура,
 * system prompt; валидация тестовым запросом.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { IconButton } from "../design-system/components/IconButton";
import { Button } from "../design-system/components/Button";
import { Input } from "../design-system/components/Input";
import { Sheet } from "../design-system/components/Sheet";
import { showToast } from "../design-system/components/Toast";
import {
  CustomProvider,
  addCustomProvider,
  deleteCustomProvider,
  listCustomProviders,
  testProvider,
} from "../core/providers";

export function ProvidersScreen({ navigation }: { navigation: any }) {
  const { state, theme, t, dispatch } = useApp();
  const insets = useSafeAreaInsets();

  const [customs, setCustoms] = useState<CustomProvider[]>([]);
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listCustomProviders();
    setCustoms(list);
    dispatch({
      type: "SET_CUSTOM_MODELS",
      models: list.map((p) => ({
        modelName: p.model,
        displayName: p.name,
        tier: "custom",
        premium: false,
        caps: [],
        baseUrl: p.baseUrl,
        providerIdx: -1,
        apiKey: p.apiKey,
        systemPrompt: p.systemPrompt,
        temperature: p.temperature,
      })),
    });
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    async (p: CustomProvider) => {
      await deleteCustomProvider(p.id);
      showToast("ok", "Провайдер удалён");
      refresh();
    },
    [refresh],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8, paddingTop: insets.top + 4, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <IconButton name="arrow-back" onPress={() => navigation.goBack()} accessibilityLabel={t("back")} />
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>Провайдеры и модели</Text>
      </View>

      <FlatList
        data={customs}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListHeaderComponent={
          <>
            <Text style={{ color: theme.mute, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
              Системные модели ({state.models.length})
            </Text>
            {state.models.map((m) => (
              <View key={m.modelName} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}>
                <MaterialIcons name="cloud-done" size={16} color={theme.accentHi} />
                <Text style={{ color: theme.text, fontSize: 13, flex: 1 }}>{m.displayName}</Text>
                <Text style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>{m.tier.toUpperCase()}</Text>
              </View>
            ))}
            <Text style={{ color: theme.mute, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 6 }}>
              Мои провайдеры ({customs.length})
            </Text>
          </>
        }
        ListEmptyComponent={
          <Text style={{ color: theme.dim, fontSize: 12.5, textAlign: "center", marginTop: 14, lineHeight: 19 }}>
            Пока нет своих провайдеров. Добавь endpoint с API-ключом — модель появится в чате.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, marginBottom: 6 }}>
            <MaterialIcons name="cloud" size={16} color={theme.accentHi} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>{item.name}</Text>
              <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>{item.model}</Text>
            </View>
            <Pressable hitSlop={10} onPress={() => remove(item)} accessibilityLabel="Удалить провайдера">
              <MaterialIcons name="delete-outline" size={18} color={theme.danger} />
            </Pressable>
          </View>
        )}
      />

      <View style={{ position: "absolute", bottom: insets.bottom + 16, left: 16, right: 16 }}>
        <Button title="＋ Добавить провайдера" onPress={() => setFormOpen(true)} fullWidth />
      </View>

      <ProviderForm visible={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); refresh(); }} />
    </View>
  );
}

/* ── Форма добавления/редактирования ── */

function ProviderForm({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const { theme } = useApp();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const valid = name.trim() && baseUrl.trim() && model.trim();

  const runTest = async () => {
    if (!baseUrl.trim() || !model.trim()) { showToast("err", "Заполни URL и модель"); return; }
    setTesting(true);
    setTestRes(null);
    const res = await testProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || null, model: model.trim() });
    setTestRes(res);
    setTesting(false);
    if (res.ok) showToast("ok", "Провайдер отвечает");
    else showToast("err", res.message);
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await addCustomProvider({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || null,
        model: model.trim(),
        temperature: Math.min(2, Math.max(0, parseFloat(temperature) || 0.7)),
        systemPrompt: systemPrompt.trim() || undefined,
      });
      showToast("ok", "Провайдер добавлен");
      onSaved();
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Новый провайдер" snapPoints={["90%"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
        <Input label="Название" placeholder="Мой GPT" value={name} onChangeText={setName} autoCapitalize="none" />
        <Input
          label="Endpoint (полный URL)"
          placeholder="https://api.example.com/v1/…"
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Input label="API-ключ (необязательно)" placeholder="sk-…" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
        <Input label="Имя модели в запросе" placeholder="gpt-4o-mini" value={model} onChangeText={setModel} autoCapitalize="none" />
        <Input label="Температура (0–2)" value={temperature} onChangeText={setTemperature} keyboardType="decimal-pad" />
        <Input label="System prompt (необязательно)" placeholder="Ты — ассистент…" value={systemPrompt} onChangeText={setSystemPrompt} multiline style={{ minHeight: 70 }} />

        {testRes && (
          <Text style={{ color: testRes.ok ? theme.ok : theme.danger, fontSize: 12 }}>
            {testRes.ok ? "✓ " : "✕ "}{testRes.message}
          </Text>
        )}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={testing ? "Проверяю…" : "Проверить"} variant="secondary" onPress={runTest} disabled={testing} fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={saving ? "Сохраняю…" : "Сохранить"} onPress={save} disabled={!valid || saving} fullWidth />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}
