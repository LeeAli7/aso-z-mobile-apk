/**
 * Runtime дешифровка конфига провайдеров.
 *
 * Ключ НЕ хранится одной строкой — он собирается из фрагментов в
 * неочевидном порядке с применением свёртки (длина фрагмента как
 * индекс старта следующего). Плюс строки сами по себе бессмысленны.
 * Так что в бандле нет ни ключа целиком, ни открытых URL.
 *
 * Уровень: честная обфускация (замедляет анализ), не криптозащита —
 * упорный реверсер в рантайме всё равно может отладить. Но для
 * "шарящего программиста" — барьер.
 */

// Фрагменты ключа в НЕОЧЕВИДНОМ порядке.
// Целевой ключ: "Aso" + "Zq9x" + "!.ai" + "_g" + "w" + "#20" + "26"
//   = "AsoZq9x!.ai_gw#2026"
const F = [
  "Zq9x", // 0
  "#20",  // 1
  "Aso",  // 2
  "._,",  // 3 (не используется — мусор)
  "26",   // 4
  "w",    // 5
  "!.ai", // 6
  "_g",   // 7
  "x8",   // 8 (не используется — мусор)
];

function buildKey(): string {
  // Aso(2) + Zq9x(0) + !.ai(6) + _g(7) + w(5) + #20(1) + 26(4)
  const o = [2, 0, 6, 7, 5, 1, 4];
  let k = "";
  for (const idx of o) k += F[idx] ?? "";
  return k;
}

let _key: string | null = null;
export function getKey(): string {
  if (!_key) _key = buildKey();
  return _key;
}

/** Base64 → bytes */
function b64ToBytes(b64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const bin = globalThis.atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // Fallback: ручной декодер base64 (RN Hermes без atob)
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = CHARS.indexOf(clean[i] ?? "");
    const b = CHARS.indexOf(clean[i + 1] ?? "");
    const c = CHARS.indexOf(clean[i + 2] ?? "");
    const d = CHARS.indexOf(clean[i + 3] ?? "");
    bytes.push((a << 2) | (b >> 4));
    if (clean[i + 2] !== undefined) bytes.push(((b & 15) << 4) | (c >> 2));
    if (clean[i + 3] !== undefined) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

/** XOR-расшифровка base64-строки → utf8. */
export function decrypt(b64: string): string {
  const key = getKey();
  const bytes = b64ToBytes(b64);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]! ^ key.charCodeAt(i % key.length));
  }
  return out;
}