/**
 * Терминал — отдельное окно, открывается из бокового меню.
 *
 * Выглядит и ведёт себя как настоящий терминал: чёрное поле, моноширинный
 * шрифт, приглашение с текущим путём, история ввода, курсор, вывод ошибок
 * красным. Команды выполняются в реальном рантайме устройства
 * (core/runtime), а не имитируются.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../design-system/components/AppIcon";
import { fonts } from "../theme/tokens";
import { useApp } from "../store/AppStore";
import { ensureRuntime, runCommandCapture, runtimeAvailable } from "../core/runtime";

type Line = { id: string; kind: "cmd" | "out" | "err"; text: string };

const HOST = "aso@device";
const promptOf = (cwd: string) => `${HOST}:${cwd}$`;
const DEFAULT_CWD = "~";

export function TerminalScreen({ navigation }: { navigation: any }) {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<Line[]>([
    { id: "hello", kind: "out", text: "Aso-z terminal · команды выполняются в рантайме устройства" },
  ]);
  const [cmd, setCmd] = useState("");
  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!runtimeAvailable()) {
      setReady("рантайм недоступен на этой платформе");
      return;
    }
    ensureRuntime()
      .then((r) => setReady(r.ok ? null : `рантайм не готов: ${r.message}`))
      .catch(() => setReady("рантайм не отвечает"));
  }, []);

  const push = useCallback((kind: Line["kind"], text: string) => {
    setLines((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, text }]);
  }, []);

  const run = useCallback(
    async (raw: string) => {
      const input = raw.trim();
      if (!input || busy) return;
      setCmd("");
      push("cmd", `${promptOf(cwd)} ${input}`);

      if (input === "clear") {
        setLines([]);
        return;
      }
      if (input === "pwd") {
        push("out", cwd);
        return;
      }

      setBusy(true);
      try {
        const res = await runCommandCapture(input);
        if (res.output) push("out", res.output.replace(/\s+$/, ""));
        if (!res.ok && res.error) push("err", res.error);
        if (!res.ok && !res.output && !res.error) push("err", `exit ${res.code}`);
        // простая поддержка cd: путь запоминаем, чтобы приглашение было честным
        if (/^cd\s+/.test(input) && res.ok) {
          const target = input.replace(/^cd\s+/, "").trim();
          setCwd(target === "~" || target === "" ? "~" : target);
        }
      } catch (e: any) {
        push("err", String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [busy, cwd, push],
  );

  const color = (kind: Line["kind"]) =>
    kind === "err" ? theme.danger : kind === "cmd" ? theme.text : theme.name === "dark" ? "#d7d7dc" : "#1c1c1f";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#000000" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: insets.top + 6, paddingBottom: 6 }}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityLabel="Назад"
        >
          <AppIcon name="arrow-left" size={22} color="#ffffff" />
        </Pressable>
        <Text style={{ flex: 1, color: "#ffffff", fontSize: 15, fontWeight: "600" }}>
          {cwd}
        </Text>
        <Pressable
          onPress={() => setLines([])}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityLabel="Очистить"
        >
          <AppIcon name="delete" size={19} color="#8e8e93" />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {lines.map((l) => (
          <Text
            key={l.id}
            selectable
            style={{
              color: color(l.kind),
              fontSize: 12.5,
              lineHeight: 19,
              fontFamily: fonts.mono,
            }}
          >
            {l.text}
          </Text>
        ))}
        {busy ? (
          <Text style={{ color: "#8e8e93", fontSize: 12.5, fontFamily: fonts.mono }}>…</Text>
        ) : null}
        {ready ? <Text style={{ color: theme.danger, fontSize: 12.5, fontFamily: fonts.mono }}>{ready}</Text> : null}
      </ScrollView>

      {/* Строка ввода настоящего терминала: приглашение и ввод в одной строке. */}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          paddingHorizontal: 14,
          paddingTop: 6,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 13, lineHeight: 20, fontFamily: fonts.mono }}>
          {promptOf(cwd) + " "}
        </Text>
        <TextInput
          ref={inputRef}
          value={cmd}
          onChangeText={setCmd}
          onSubmitEditing={() => void run(cmd)}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          returnKeyType="send"
          blurOnSubmit={false}
          selectionColor="#ffffff"
          autoFocus
          cursorColor="#ffffff"
          style={{ flex: 1, color: "#ffffff", fontSize: 13, lineHeight: 20, fontFamily: fonts.mono, padding: 0, margin: 0 }}
        />
      </Pressable>
    </KeyboardAvoidingView>
  );
}
