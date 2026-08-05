/**
 * Зашифрованный конфиг провайдеров.
 * Все строки — base64 от шифрования. Ключ собирается из фрагментов
 * в crypto.ts (перестановка + свёртка). Декодирование в рантайме.
 */

export const ENCRYPTED_PROVIDERS = [
  // gateway A — 4 модели
  {
    e: "KQcbKgIDVw5BEQwxBBhHVx5TX24JCjReT0kOTQkIK0gUTF9AXlM1GgA0Ag==",
    m: [
      { n: "deepseek-v4-flash-free", d: "Aso Math", tier: "flash", prem: true },
      { n: "north-mini-code-free", d: "Aso Code", tier: "code", prem: false },
      { n: "nemotron-3-ultra-free", d: "Aso Super", tier: "ultra", prem: false },
      { n: "mimo-v2.5-free", d: "Aso Multi", tier: "ultra", prem: true, caps: ["V", "S", "D", "W"] },
    ],
  },
  // gateway B — 2 модели
  {
    e: "KQcbKgIDVw5PEQBxDB5PXR5TX24SHzNeVghEQBMGKhMSUR1TWlc1XAw1HEkURFoIBjEU",
    m: [
      { n: "stepfun/step-3.7-flash:free", d: "Aso", tier: "flash", prem: false, caps: ["V"] },
      { n: "poolside/laguna-m.1:free", d: "Aso Ultra", tier: "ultra", prem: true },
    ],
  },
] as const;

/** Флаг: использовать прямой канал (true). Всегда true — приложение автономно. */
export const DIRECT_CHANNEL = true;