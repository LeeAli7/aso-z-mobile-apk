/**
 * RichMarkdown — рендер ответов AI.
 *
 * Без глобального состояния (исправлен race condition старого рендера):
 * весь парсинг выполняется внутри компонента с локальными переменными.
 * Поддерживает: код-блоки (с кнопкой копирования), заголовки, списки,
 * цитаты, ссылки, bold/italic/inline-code, таблицы (базово, как текст).
 */
import React, { useMemo } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useApp } from "../store/AppStore";
import { showToast } from "../design-system/components/Toast";
import * as Clipboard from "expo-clipboard";

/* ── Inline-разбор: **bold**, *italic*, `code`, [text](url) ── */

function renderInline(text: string, theme: any, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<Text key={`${keyPrefix}-t${k++}`}>{text.slice(last, m.index)}</Text>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <Text key={`${keyPrefix}-b${k++}`} style={{ fontWeight: "700", color: theme.text }}>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <Text key={`${keyPrefix}-c${k++}`} style={{ fontFamily: "monospace", color: theme.codeText, backgroundColor: theme.codeBg, paddingHorizontal: 3, borderRadius: 4 }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else if (tok.startsWith("[")) {
      const label = m[2];
      const url = m[3];
      nodes.push(
        <Text
          key={`${keyPrefix}-l${k++}`}
          style={{ color: theme.accentHi, textDecorationLine: "underline" }}
          onPress={() => Linking.openURL(url).catch(() => {})}
        >
          {label}
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={`${keyPrefix}-i${k++}`} style={{ fontStyle: "italic", color: theme.text }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(<Text key={`${keyPrefix}-l${k++}`}>{text.slice(last)}</Text>);
  return nodes;
}

/* ── Компонент ── */

export function RichMarkdown({ content }: { content: string }) {
  const { theme } = useApp();
  const nodes = useMemo(() => {
    const src = content ?? "";
    if (!src) return [];
    const lines = src.split("\n");
    const out: React.ReactNode[] = [];
    let i = 0;
    let k = 0;

    while (i < lines.length) {
      const line = lines[i];

      // код-блок ```lang ... ```
      if (line.trimStart().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const buf: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
          buf.push(lines[i]);
          i++;
        }
        i++; // закрывающий ```
        const code = buf.join("\n");
        const key = k++;
        out.push(
          <View key={`code${key}`} style={{ marginVertical: 6, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: theme.border, backgroundColor: theme.codeBg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.surface2 }}>
              <Text style={{ color: theme.mute, fontSize: 9.5, fontFamily: "monospace" }}>{lang || "code"}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => Clipboard.setStringAsync(code).then(() => showToast("ok", "Код скопирован"))}
                style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
                accessibilityLabel="Копировать код"
              >
                <MaterialIcons name="content-copy" size={11} color={theme.dim} />
                <Text style={{ color: theme.dim, fontSize: 10 }}>Копировать</Text>
              </Pressable>
            </View>
            <Text selectable style={{ color: theme.codeText, fontFamily: "monospace", fontSize: 12, lineHeight: 17, padding: 10 }}>
              {code}
            </Text>
          </View>,
        );
        continue;
      }

      // заголовки ## ### ####
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        out.push(
          <Text key={`h${k++}`} style={{ color: theme.text, fontSize: level <= 2 ? 16 : 14, fontWeight: "700", marginTop: 8, marginBottom: 3 }}>
            {renderInline(h[2] ?? "", theme, `h${k}`)}
          </Text>,
        );
        i++;
        continue;
      }

      // маркированный список: - / * / •  (соберём подряд)
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      if (ul) {
        const items: string[] = [];
        while (i < lines.length) {
          const m2 = lines[i].match(/^\s*[-*•]\s+(.*)$/);
          if (m2) { items.push(m2[1] ?? ""); i++; } else break;
        }
        out.push(
          <View key={`ul${k++}`} style={{ marginVertical: 2 }}>
            {items.map((it, idx) => (
              <View key={idx} style={{ flexDirection: "row", gap: 6, marginBottom: 2 }}>
                <Text style={{ color: theme.accentHi, fontSize: 14, lineHeight: 20 }}>•</Text>
                <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
                  {renderInline(it, theme, `uli${k}-${idx}`)}
                </Text>
              </View>
            ))}
          </View>,
        );
        continue;
      }

      // нумерованный список: 1. 2. ...
      const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (ol) {
        const items: { num: string; text: string }[] = [];
        while (i < lines.length) {
          const m2 = lines[i].match(/^\s*(\d+)[.)]\s+(.*)$/);
          if (m2) { items.push({ num: m2[1] ?? "", text: m2[2] ?? "" }); i++; } else break;
        }
        out.push(
          <View key={`ol${k++}`} style={{ marginVertical: 2 }}>
            {items.map((it, idx) => (
              <View key={idx} style={{ flexDirection: "row", gap: 6, marginBottom: 2 }}>
                <Text style={{ color: theme.dim, fontSize: 14, lineHeight: 20, width: 20 }}>{it.num}.</Text>
                <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
                  {renderInline(it.text, theme, `oli${k}-${idx}`)}
                </Text>
              </View>
            ))}
          </View>,
        );
        continue;
      }

      // markdown-таблица: заголовок | ячейки |, разделитель |-|-|, строки
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        // собираем все строки таблицы подряд
        const rows: string[][] = [];
        const header = line.split("|").map((c) => c.trim());
        rows.push(header.filter((_, idx) => idx > 0 || header.length > 2));
        i += 2; // пропускаем заголовок и разделитель
        while (i < lines.length && lines[i].includes("|")) {
          const cells = lines[i].split("|").map((c) => c.trim());
          rows.push(cells);
          i++;
        }
        // нормализуем ширину строк
        const width = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => {
          const c = [...r];
          while (c.length < width) c.push("");
          return c.slice(0, width);
        });
        const headerRow = norm[0];
        const bodyRows = norm.slice(1);
        out.push(
          <View key={`tbl${k++}`} style={{ marginVertical: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 10, overflow: "hidden" }}>
            {/* шапка */}
            <View style={{ flexDirection: "row", backgroundColor: theme.surface2, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              {headerRow.map((c, ci) => (
                <View key={ci} style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 6, borderRightWidth: ci < headerRow.length - 1 ? 1 : 0, borderRightColor: theme.border }}>
                  <Text style={{ color: theme.text, fontSize: 12.5, fontWeight: "700" }}>{renderInline(c, theme, `th${k}-${ci}`)}</Text>
                </View>
              ))}
            </View>
            {/* тело */}
            {bodyRows.map((row, ri) => (
              <View key={ri} style={{ flexDirection: "row", backgroundColor: ri % 2 === 1 ? theme.surface : "transparent", borderBottomWidth: ri < bodyRows.length - 1 ? 1 : 0, borderBottomColor: theme.border }}>
                {row.map((c, ci) => (
                  <View key={ci} style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: ci < row.length - 1 ? 1 : 0, borderRightColor: theme.border }}>
                    <Text style={{ color: theme.text, fontSize: 12.5, lineHeight: 17 }}>{renderInline(c, theme, `td${k}-${ri}-${ci}`)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>,
        );
        continue;
      }

      // цитата > text
      const q = line.match(/^\s*>\s?(.*)$/);
      if (q) {
        out.push(
          <View key={`q${k++}`} style={{ borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 10, marginVertical: 3 }}>
            <Text style={{ color: theme.dim, fontSize: 13.5, lineHeight: 20, fontStyle: "italic" }}>
              {renderInline(q[1] ?? "", theme, `q${k}`)}
            </Text>
          </View>,
        );
        i++;
        continue;
      }

      // пустая строка
      if (!line.trim()) {
        out.push(<View key={`sp${k++}`} style={{ height: 6 }} />);
        i++;
        continue;
      }

      // обычный абзац
      out.push(
        <Text key={`p${k++}`} style={{ color: theme.text, fontSize: 14, lineHeight: 20, marginBottom: 4 }}>
          {renderInline(line.trim(), theme, `p${k}`)}
        </Text>,
      );
      i++;
    }
    return out;
  }, [content, theme]);

  return <View>{nodes}</View>;
}

/** Обратная совместимость: функция-обёртка. */
export function renderMarkdown(content: string | null | undefined, theme: any): React.ReactNode {
  return <RichMarkdown content={content ?? ""} />;
}
