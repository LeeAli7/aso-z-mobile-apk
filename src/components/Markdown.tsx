/**
 * Лёгкий markdown-рендер для сообщений AI.
 * Порт ключевой логики TMA formatContent: код-блоки сначала
 * вырезаются в плейсхолдеры, потом текст, потом восстановление.
 * Здесь рендерим через <Text> с вложенными <Text> (bold/code/italic).
 */
import React from "react";
import { Text } from "react-native";

interface ThemeLike {
  text: string;
  codeBg: string;
  codeText: string;
  accent: string;
}

/** Превращает знаки ```...``` в маркеры, чтобы оставить внутри <Text> mono. */
function splitCodeBlocks(md: string): string[] {
  // разбиваем по ```lang\n...```
  const parts: string[] = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(md))) {
    if (m.index > last) parts.push(md.slice(last, m.index));
    parts.push("\u0000CODE" + i++ + "\u0000");
    last = m.index + m[0].length;
  }
  if (last < md.length) parts.push(md.slice(last));
  return parts.length ? parts : [md];
}

const codeBlocks: Record<number, string> = {};
let codeCounter = 0;

function renderInline(text: string, theme: ThemeLike, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  // матчим **bold**, `code`, *italic*
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
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
        <Text key={`${keyPrefix}-c${k++}`} style={{ fontFamily: "monospace", color: theme.codeText, backgroundColor: theme.codeBg }}>
          {tok.slice(1, -1)}
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

export function renderMarkdown(md: string | null | undefined, theme: ThemeLike): React.ReactNode {
  const src = md ?? "";
  if (!src) return null;

  // 1. вырезать код-блоки
  codeCounter = 0;
  Object.keys(codeBlocks).forEach((k) => delete codeBlocks[+k]);
  const lines = src.split("\n");
  const out: React.ReactNode[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let codeLang = "";

  const flush = (key: string) => {
    if (buffer.length === 0) return;
    const para = buffer.join("\n");
    buffer = [];
    if (!para.trim()) return;
    out.push(<Text key={key} style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>{renderInline(para, theme, key)}</Text>);
  };

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) {
      if (!inCode) {
        flush("t" + i);
        inCode = true;
        codeLang = line.trim().slice(3).trim();
        const cid = codeCounter++;
        codeBlocks[cid] = "";
        out.push(<Text key={`code-${i}`} style={{ color: theme.codeText }}>{"\u0000CODE" + cid + "\u0000"}</Text>);
      } else {
        const cid = codeCounter - 1;
        out.push(
          <Text key={`code-end-${i}`} style={{ fontFamily: "monospace", color: theme.codeText, backgroundColor: theme.codeBg }}>{codeBlocks[cid]}</Text>,
        );
        inCode = false;
      }
      return;
    }
    if (inCode) {
      const cid = codeCounter - 1;
      // строки кода рендерим отдельными mono-элементами
      out.push(
        <Text key={`code-l-${cid}-${i}`} style={{ fontFamily: "monospace", color: theme.codeText, backgroundColor: theme.codeBg }}>
          {line}
        </Text>,
      );
      return;
    }
    // заголовки
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flush("h" + i);
      out.push(
        <Text key={`head-${i}`} style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 8, marginBottom: 2 }}>
          {h[2]}
        </Text>,
      );
      return;
    }
    buffer.push(line);
  });
  flush("end");
  return out;
}