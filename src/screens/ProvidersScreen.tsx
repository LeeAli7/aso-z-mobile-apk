/**
 * Провайдеры — системные модели + свои endpoint'ы с API-ключами.
 *
 * Логика как у ТГ-бота Aso: ПРОВАЙДЕР = контейнер со списком моделей.
 * У провайдера: имя, endpoint, API-ключ. Внутри — модели (имя, температура,
 * system prompt). Можно добавлять/редактировать/удалять модели, тестировать
 * каждую отдельно.
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
  CustomModel,
  addCustomModel,
  addCustomProvider,
  deleteCustomModel,
  deleteCustomProvider,
  listCustomProviders,
  providersToModels,
  testProvider,
  updateCustomModel,
  updateCustomProvider,
} from "../core/providers";

export function ProvidersScreen({ navigation }: { navigation: any }) {
  const { state, theme, dispatch } = useApp();
  const insets = useSafeAreaInsets();

  const [customs, setCustoms] = useState<CustomProvider[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null); // раскрытый провайдер
  const [providerForm, setProviderForm] = useState(false);
  const [editProvider, setEditProvider] = useState<CustomProvider | null>(null);
  const [modelForm, setModelForm] = useState<{ provider: CustomProvider; model?: CustomModel } | null>(null);

  const refresh = useCallback(async () => {
    const list = await listCustomProviders();
    setCustoms(list);
    dispatch({ type: "SET_CUSTOM_MODELS", models: providersToModels(list) });
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleExpand = (id: string) => setExpanded((prev) => (prev === id ? null : id));

  const removeProvider = useCallback(
    async (p: CustomProvider) => {
      await deleteCustomProvider(p.id);
      showToast("ok", "Провайдер удалён");
      refresh();
    },
    [refresh],
  );

  const removeModel = useCallback(
    async (p: CustomProvider, m: CustomModel) => {
      await deleteCustomModel(p.id, m.id);
      showToast("ok", "Модель удалена");
      refresh();
    },
    [refresh],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8, paddingTop: insets.top + 4, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <IconButton name="arrow-back" onPress={() => navigation.goBack()} accessibilityLabel="Назад" />
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
            Пока нет своих провайдеров. Добавь endpoint с API-ключом, затем добавь к нему модели.
          </Text>
        }
        renderItem={({ item }) => {
          const open = expanded === item.id;
          return (
            <View style={{ marginBottom: 8 }}>
              {/* карточка провайдера */}
              <Pressable
                onPress={() => toggleExpand(item.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: open ? theme.accent : theme.border, backgroundColor: theme.surface }}
              >
                <MaterialIcons name={open ? "expand-more" : "chevron-right"} size={18} color={theme.accentHi} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "600" }}>{item.name}</Text>
                  <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 10, fontFamily: "monospace" }}>{item.baseUrl}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Pressable hitSlop={10} onPress={() => { setEditProvider(item); setProviderForm(true); }} accessibilityLabel="Редактировать провайдера">
                    <MaterialIcons name="edit" size={17} color={theme.accentHi} />
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => removeProvider(item)} accessibilityLabel="Удалить провайдера">
                    <MaterialIcons name="delete-outline" size={18} color={theme.danger} />
                  </Pressable>
                </View>
              </Pressable>

              {/* модели провайдера */}
              {open && (
                <View style={{ marginTop: 4, paddingLeft: 12 }}>
                  {item.models.length === 0 && (
                    <Text style={{ color: theme.dim, fontSize: 11.5, paddingVertical: 6 }}>
                      Моделей пока нет. Добавь первую — она появится в чате.
                    </Text>
                  )}
                  {item.models.map((m) => (
                    <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, marginTop: 5 }}>
                      <MaterialIcons name="smart-toy" size={15} color={theme.accentHi} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 12.5, fontWeight: "600" }}>{m.name}</Text>
                        <Text numberOfLines={1} style={{ color: theme.mute, fontSize: 9.5, fontFamily: "monospace" }}>
                          temp {m.temperature ?? 0.7}{m.systemPrompt ? " · prompt" : ""}
                        </Text>
                      </View>
                      <Pressable hitSlop={10} onPress={() => setModelForm({ provider: item, model: m })} accessibilityLabel="Редактировать модель">
                        <MaterialIcons name="edit" size={16} color={theme.accentHi} />
                      </Pressable>
                      <Pressable hitSlop={10} onPress={() => removeModel(item, m)} accessibilityLabel="Удалить модель">
                        <MaterialIcons name="delete-outline" size={17} color={theme.danger} />
                      </Pressable>
                    </View>
                  ))}
                  <Button title="＋ Добавить модель" variant="secondary" onPress={() => setModelForm({ provider: item })} style={{ marginTop: 7 }} />
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={{ position: "absolute", bottom: insets.bottom + 16, left: 16, right: 16 }}>
        <Button title="＋ Добавить провайдера" onPress={() => { setEditProvider(null); setProviderForm(true); }} fullWidth />
      </View>

      {/* форма провайдера (добавить/редактировать) */}
      <ProviderForm
        visible={providerForm}
        initial={editProvider}
        onClose={() => setProviderForm(false)}
        onSaved={() => { setProviderForm(false); refresh(); }}
      />

      {/* форма модели (добавить/редактировать) */}
      {modelForm && (
        <ModelForm
          provider={modelForm.provider}
          initial={modelForm.model}
          onClose={() => setModelForm(null)}
          onSaved={() => { setModelForm(null); refresh(); }}
        />
      )}
    </View>
  );
}

/* ── Форма провайдера (имя / endpoint / ключ) ── */

function ProviderForm({ visible, initial, onClose, onSaved }: { visible: boolean; initial: CustomProvider | null; onClose: () => void; onSaved: () => void }) {
  const { theme } = useApp();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setBaseUrl(initial?.baseUrl ?? "");
      setApiKey(initial?.apiKey ?? "");
    }
  }, [visible, initial]);

  const valid = name.trim() && baseUrl.trim();

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (initial) {
        await updateCustomProvider(initial.id, { name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || null });
        showToast("ok", "Провайдер обновлён");
      } else {
        await addCustomProvider({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || null, models: [] });
        showToast("ok", "Провайдер добавлен");
      }
      onSaved();
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={initial ? "Редактировать провайдера" : "Новый провайдер"} snapPoints={["55%"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
        <Input label="Название" placeholder="Мой сервер" value={name} onChangeText={setName} autoCapitalize="none" />
        <Input
          label="Endpoint (полный URL)"
          placeholder="https://api.example.com/v1"
          helper="Можно без /chat/completions — приложение добавит само"
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Input label="API-ключ (необязательно)" placeholder="sk-…" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
        <Text style={{ color: theme.dim, fontSize: 11, lineHeight: 16 }}>
          После сохранения добавь к провайдеру модели — каждая появится в чате.
        </Text>
        <Button title={saving ? "Сохраняю…" : "Сохранить"} onPress={save} disabled={!valid || saving} fullWidth />
      </ScrollView>
    </Sheet>
  );
}

/* ── Форма модели (имя / температура / system prompt) ── */

function ModelForm({ provider, initial, onClose, onSaved }: { provider: CustomProvider; initial?: CustomModel; onClose: () => void; onSaved: () => void }) {
  const { theme } = useApp();
  const [name, setName] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setName(initial.name ?? "");
      setTemperature(String(initial.temperature ?? 0.7));
      setSystemPrompt(initial.systemPrompt ?? "");
    }
  }, [initial]);

  const valid = name.trim();

  const runTest = async () => {
    if (!provider.baseUrl.trim() || !name.trim()) { showToast("err", "Заполни URL провайдера и имя модели"); return; }
    setTesting(true);
    setTestRes(null);
    const res = await testProvider({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: name.trim() });
    setTestRes(res);
    setTesting(false);
    if (res.ok) showToast("ok", "Модель отвечает");
    else showToast("err", res.message);
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const patch = {
        name: name.trim(),
        temperature: Math.min(2, Math.max(0, parseFloat(temperature) || 0.7)),
        systemPrompt: systemPrompt.trim() || undefined,
      };
      if (initial) {
        await updateCustomModel(provider.id, initial.id, patch);
        showToast("ok", "Модель обновлена");
      } else {
        await addCustomModel(provider.id, patch);
        showToast("ok", "Модель добавлена");
      }
      onSaved();
    } catch (e: any) {
      showToast("err", String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={initial ? "Редактировать модель" : "Новая модель"} snapPoints={["70%"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
        <Text style={{ color: theme.dim, fontSize: 11 }}>
          Провайдер: {provider.name} · {provider.baseUrl}
        </Text>
        <Input label="Имя модели в запросе" placeholder="gpt-4o-mini" value={name} onChangeText={setName} autoCapitalize="none" />
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
