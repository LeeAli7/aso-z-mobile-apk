/**
 * RichMarkdown — рендер ответов AI.
 *
 * Без глобального состояния (исправлен race condition старого рендера):
 * весь парсинг выполняется внутри компонента с локальными переменными.
 * Поддерживает: код-блоки (с кнопкой копирования), заголовки, списки,
 * цитаты, ссылки, bold/italic/inline-code, таблицы (базово, как текст).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, PanResponder, Pressable, ScrollView, Text, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppIcon } from "../design-system/components/AppIcon";
import { useApp } from "../store/AppStore";
import { fonts } from "../theme/tokens";
import { showToast } from "../design-system/components/Toast";
import * as Clipboard from "expo-clipboard";

/* ── Подсветка синтаксиса (палитра VS Code Dark+, как prism4j у Kimi) ── */

const TOKEN_COLORS: Record<string, string> = {
  comment: "#6a9955", // //, /* */, # python
  string: "#ce9178", // "…" '…' `…`
  keyword: "#569cd6", // if/for/const/function/import...
  number: "#b5cea8",
  func: "#dcdcaa", // имя функции
  type: "#4ec9b0", // классы/типы
  property: "#9cdcfe", // члены/свойства
  plain: "#d4d4d4",
  lang: "#f0db4f",
};

const KEYWORDS =
  "\\b(?:function|const|let|var|return|if|else|for|while|do|switch|case|break|continue|new|class|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|def|lambda|pass|with|as|raise|except|yield|global|return|and|or|not|None|True|False|select|from|where|group|by|order|having|join|left|right|inner|outer|on)\\b";

// Регекс-токенизатор: жадные токены по приоритету.
const TOKEN_RE = new RegExp(
  [
    `(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)`, // 1 comment (блок/строка js)
    `(#[^\\n]*)`, // 2 comment (# python/shell)
    `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`, // 3 string (двойные/одинарные)
    `(${KEYWORDS})`, // 4 keyword
    `(\\b(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b)`, // 5 number
    `(\\b[A-Za-z_$][\\w$]*(?:\\s*\\())`, // 6 func call
    `(\\b[A-Z][A-Za-z0-9_]*\\b)`, // 7 Type/класс (CamelCase)
    `([A-Za-z_$][\\w$]*)`, // 8 identifier
  ].join("|"),
);

interface Tok {
  text: string;
  color: string;
}

function tokenize(code: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, "g");
  while ((m = re.exec(code))) {
    if (m.index > last) out.push({ text: code.slice(last, m.index), color: TOKEN_COLORS.plain });
    const [full] = m;
    // индекс группы (m[1]..m[8])
    for (let g = 1; g <= 8; g++) {
      if (m[g] !== undefined) {
        const type =
          g === 1 || g === 2 ? "comment" :
          g === 3 ? "string" :
          g === 4 ? "keyword" :
          g === 5 ? "number" :
          g === 6 ? "func" :
          g === 7 ? "type" : "plain";
        out.push({ text: full, color: TOKEN_COLORS[type] });
        break;
      }
    }
    last = m.index + full.length;
  }
  if (last < code.length) out.push({ text: code.slice(last), color: TOKEN_COLORS.plain });
  return out;
}

/* ── Формулы: $C_nH_{2n-2}$ → CₙH₂ₙ₋₂ (юникод-индексы, без внешних зависимостей) ── */

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ",
  m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈",
  equiv: "≡", infty: "∞", degree: "°", circ: "∘", ang: "∠", perp: "⊥", parallel: "∥",
  sum: "∑", prod: "∏", int: "∫", sqrt: "√", partial: "∂", nabla: "∇", in: "∈", notin: "∉",
  cup: "∪", cap: "∩", subset: "⊂", supset: "⊃", forall: "∀", exists: "∃", percent: "%",
};

/** Превратить тело формулы в юникод: индексы, греческий, знаки, без служебных команд. */
export function formulaToText(src: string): string {
  let s = String(src || "").trim();
  // \ce{H2O}, \mathrm{...}, \text{...} — оставляем только содержимое
  s = s.replace(/\\(?:ce|mathrm|text|textbf|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  // служебные: пробелы, тонкие пробелы, скобки-разделители
  s = s.replace(/\\(left|right|big|Big|bigl|bigr|!|,|;|:| )/g, "");
  // греческие и символы
  s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? SYMBOLS[name] ?? name);
  // индексы: _{...} / _x и ^{...} / ^x
  const conv = (chunk: string, tbl: Record<string, string>) =>
    chunk.split("").map((c) => tbl[c] ?? c).join("");
  s = s.replace(/_\{([^{}]*)\}/g, (_m, g: string) => conv(g, SUB));
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, g: string) => conv(g, SUP));
  s = s.replace(/_([A-Za-z0-9+\-=()])/g, (_m, g: string) => conv(g, SUB));
  s = s.replace(/\^([A-Za-z0-9+\-=()])/g, (_m, g: string) => conv(g, SUP));
  // хвосты: пустые группы, двойные пробелы
  s = s.replace(/[{}]/g, "").replace(/\s{2,}/g, " ").trim();
  return s;
}

/**
 * Формула ли это внутри $...$.
 * Раньше требовалось два подряд идущих латинских символа — из-за этого
 * $R-O-R'$, $N, O, S$ и $R- $ оставались сырым текстом с долларами.
 * Теперь: индексы/команды — всегда формула; иначе нужна буква и хоть один
 * признак химии/математики (заглавная, цифра, дефис, скобка).
 * «$5», «$100» (только цифры) и «$слово» (строчные буквы) формулой не считаются.
 */
const looksLikeFormula = (body: string) => {
  const t = body.trim();
  if (!t) return false;
  if (/[_^\\]/.test(t)) return true;
  const hasLetter = /[A-Za-zА-Яа-я]/.test(t);
  if (!hasLetter) return false;
  return /[A-ZА-Я]/.test(t) || /[0-9]/.test(t) || /[-+=(]/.test(t);
};

/* ── Inline-разбор: **bold**, *italic*, `code`, [text](url), $формула$ ── */

function renderInline(text: string, theme: any, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\$[^$\n]{1,200}\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<Text key={`${keyPrefix}-t${k++}`}>{text.slice(last, m.index)}</Text>);
    const tok = m[0];
    if (tok.startsWith("$") && tok.length > 2) {
      const body = tok.slice(1, -1);
      if (looksLikeFormula(body)) {
        nodes.push(
          <Text key={`${keyPrefix}-f${k++}`} style={{ fontFamily: fonts.mono, color: theme.text }}>
            {formulaToText(body)}
          </Text>,
        );
      } else {
        // просто деньги или одна буква: «$5», «$x» — оставляем как текст
        nodes.push(<Text key={`${keyPrefix}-t${k++}`}>{tok}</Text>);
      }
    } else if (tok.startsWith("**")) {
      nodes.push(
        <Text key={`${keyPrefix}-b${k++}`} style={{ fontWeight: "700", color: theme.text }}>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <Text key={`${keyPrefix}-c${k++}`} style={{ fontFamily: fonts.mono, color: theme.codeText, backgroundColor: theme.codeBg, paddingHorizontal: 3, borderRadius: 6 }}>
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

/* ── Код-блок (Kimi-стиль: шапка с языком + копировать + wrap, подсветка) ── */

function CodeBlock({ code, lang, theme }: { code: string; lang: string; theme: any }) {
  const [wrapped, setWrapped] = useState(false);
  const tokens = useMemo(() => tokenize(code), [code]);
  return (
    <View style={{ marginVertical: 6, borderRadius: 20, overflow: "hidden", backgroundColor: theme.codeBg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.codeBg }}>
        <Text style={{ color: theme.codeText, fontSize: 9.5, fontFamily: fonts.mono, opacity: 1 }}>{lang || "code"}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            hitSlop={8}
            onPress={() => setWrapped(!wrapped)}
            accessibilityLabel={wrapped ? "Перенос выключен" : "Перенос включен"}
            style={{ width: 32, height: 32, borderRadius: 20, alignItems: "center", justifyContent: "center" }}
          >
            <AppIcon name="wrap" size={13} color={wrapped ? theme.codeText : theme.dim} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => Clipboard.setStringAsync(code).then(() => showToast("ok", "Код скопирован"))}
            style={{ width: 32, height: 32, borderRadius: 20, alignItems: "center", justifyContent: "center" }}
            accessibilityLabel="Копировать код"
          >
            <AppIcon name="copy" size={13} color={theme.codeText} />
          </Pressable>
        </View>
      </View>
      <Text selectable style={{ color: theme.codeText, fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, padding: 10 }}>
        {tokens.map((t, i) => (
          <Text key={i} style={{ color: t.color, fontFamily: fonts.mono, fontSize: 12 }}>
            {t.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}


/* ── Таблица ── */

const TBL_FS = 12.5;
const TBL_LH = 18;
const TBL_MIN = 84;
const TBL_MAX = 240;
const TBL_PAD = 10;

/** Грубая ширина строки в px — для колонок по содержимому. */
function textW(s: string) {
  let w = 0;
  for (const ch of s) w += /[iIl1.,:;'`|!]/.test(ch) ? 4.2 : ch === " " ? 3.6 : 6.9;
  return w;
}

/**
 * Таблица: кегль фиксированный, колонки по содержимому, шире экрана —
 * горизонтальный скролл. Раньше колонки делились поровну (flex:1) и при
 * 6+ столбцах кегль падал до 10.5, строки наезжали друг на друга.
 */
/**
 * Шина «таблицу сейчас тянут вбок».
 * Вложенный горизонтальный ScrollView внутри FlatList на Android отдаёт жест
 * списку, и таблица едет только с третьей попытки. Пока палец движется по X,
 * мы гасим вертикальный скролл списка — тогда жест забирает таблица.
 */
type TablePanPhase = "start" | "move" | "end";
type TablePanListener = (phase: TablePanPhase, dy: number, vy: number) => void;
const tablePanListeners = new Set<TablePanListener>();
export function onTablePan(l: TablePanListener): () => void {
  tablePanListeners.add(l);
  return () => {
    tablePanListeners.delete(l);
  };
}
function emitTablePan(phase: TablePanPhase, dy = 0, vy = 0) {
  tablePanListeners.forEach((l) => {
    try {
      l(phase, dy, vy);
    } catch {}
  });
}

function TableNode({ rows, theme, uid }: { rows: string[][]; theme: any; uid: string }) {
  const [boxW, setBoxW] = useState(0);
  const [viewW, setViewW] = useState(0);
  const cols = rows[0]?.length ?? 0;
  const widths = useMemo(() => {
    const natural: number[] = [];
    for (let ci = 0; ci < cols; ci++) {
      const longest = rows.reduce((m, r) => Math.max(m, textW(r[ci] ?? "")), 0);
      natural.push(Math.min(TBL_MAX, Math.max(TBL_MIN, longest + TBL_PAD * 2 + 2)));
    }
    const total = natural.reduce((a, b) => a + b, 0);
    if (boxW > 0 && total < boxW) {
      const k = boxW / total;
      return { list: natural.map((w) => Math.floor(w * k)), total: boxW };
    }
    return { list: natural, total };
  }, [rows, cols, boxW]);

  // ── Полный контроль над жестом ─────────────────────────────────────────────
  // На Android вложенный горизонтальный ScrollView проигрывает вертикальному
  // списку: касание «залипает» в родителе, и таблица едет только с 3–4 попытки.
  // Поэтому мы забираем касание сразу и ведём его сами: по X двигаем таблицу,
  // по Y прокручиваем список через события (см. onTablePan в ChatScreen).
  const sref = useRef<ScrollView | null>(null);
  const posX = useRef(0);
  const baseX = useRef(0);
  const axis = useRef<"x" | "y" | null>(null);
  const lastDy = useRef(0);
  const maxX = Math.max(0, widths.total - viewW);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Забираем касание сразу — иначе вертикальный список успевает
        // «залипнуть» и таблица едет только с третьей попытки.
        onStartShouldSetPanResponderCapture: () => maxX > 0,
        onMoveShouldSetPanResponderCapture: () => maxX > 0,
        // По вертикали нативный список работает сам (инерция, плавность) —
        // мы не блокируем его события и не скроллим вручную.
        onShouldBlockNativeResponder: () => false,
        onPanResponderGrant: () => {
          baseX.current = posX.current;
          lastDy.current = 0;
        },
        onPanResponderMove: (_e, g) => {
          if (maxX <= 0) return;
          const nx = Math.min(maxX, Math.max(0, baseX.current - g.dx));
          posX.current = nx;
          sref.current?.scrollTo({ x: nx, animated: false });
        },
        onPanResponderRelease: (_e, g) => {
          if (maxX <= 0) return;
          // инерция: докручиваем по скорости, как у нативного скролла
          const proj = Math.min(maxX, Math.max(0, posX.current - g.vx * 180));
          sref.current?.scrollTo({ x: proj, animated: true });
          posX.current = proj;
          setFades(proj);
        },
        onPanResponderTerminate: () => {},
        onPanResponderTerminationRequest: () => false,
      }),
    [maxX],
  );

  const fadeL = useRef(new Animated.Value(0)).current;
  const fadeR = useRef(new Animated.Value(0)).current;
  const setFades = (x: number) => {
    Animated.timing(fadeL, { toValue: x > 4 ? 1 : 0, duration: 140, useNativeDriver: true }).start();
    Animated.timing(fadeR, { toValue: x < maxX - 4 ? 1 : 0, duration: 140, useNativeDriver: true }).start();
  };
  useEffect(() => {
    setFades(posX.current);
  }, [maxX]);

  const [head, ...body] = rows;
  const cellStyle = (ci: number) => ({
    width: widths.list[ci],
    paddingHorizontal: TBL_PAD,
    paddingVertical: 7,
    borderRightWidth: ci < cols - 1 ? 1 : 0,
    borderRightColor: theme.border,
  });

  return (
    <View
      style={{ marginVertical: 8 }}
      onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        }}
        onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={sref}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          bounces={false}
          scrollEventThrottle={16}
          onScroll={(e) => {
            posX.current = e.nativeEvent.contentOffset.x;
            setFades(posX.current);
          }}
          style={{ maxWidth: "100%" }}
        >
          <View style={{ width: widths.total }}>
            <View style={{ flexDirection: "row", backgroundColor: theme.surface2, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              {head.map((c, ci) => (
                <View key={ci} style={cellStyle(ci)}>
                  <Text style={{ color: theme.text, fontSize: TBL_FS, lineHeight: TBL_LH, fontWeight: "700" }}>
                    {renderInline(c, theme, `th${uid}${ci}`)}
                  </Text>
                </View>
              ))}
            </View>
            {body.map((row, ri) => (
              <View
                key={ri}
                style={{
                  flexDirection: "row",
                  backgroundColor: ri % 2 === 1 ? theme.surface : "transparent",
                  borderBottomWidth: ri < body.length - 1 ? 1 : 0,
                  borderBottomColor: theme.border,
                }}
              >
                {row.map((c, ci) => (
                  <View key={ci} style={cellStyle(ci)}>
                    <Text style={{ color: theme.text, fontSize: TBL_FS, lineHeight: TBL_LH }}>
                      {renderInline(c, theme, `td${uid}${ri}${ci}`)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
        {/* края уходят в темноту, как верх и низ экрана: намёк, что таблица шире */}
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 26, opacity: fadeL }}
        >
          <LinearGradient
            colors={[theme.surface, "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 26, opacity: fadeR }}
        >
          <LinearGradient
            colors={["transparent", theme.surface]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </View>
  );
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
        out.push(<CodeBlock key={`code${key}`} code={code} lang={lang} theme={theme} />);
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
        // splitRow: разбивает строку таблицы, отбрасывая пустые крайние ячейки,
        // которые образуются от обрамляющих пайп (иначе — «пустые ряды» по бокам)
        const splitRow = (l: string) => {
          const cells = l.trim().split("|").map((c) => c.trim());
          if (cells[0] === "") cells.shift();
          if (cells[cells.length - 1] === "") cells.pop();
          return cells;
        };
        const rows: string[][] = [];
        rows.push(splitRow(line));
        i += 2; // пропускаем заголовок и разделитель
        while (i < lines.length && lines[i].includes("|")) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        // нормализуем ширину строк
        const width = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => {
          const c = [...r];
          while (c.length < width) c.push("");
          return c.slice(0, width);
        });
        out.push(<TableNode key={`tbl${k++}`} rows={norm} theme={theme} uid={String(k)} />);
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
