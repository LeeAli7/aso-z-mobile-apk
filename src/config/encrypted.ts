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
      { n: "JRYKKgJcHUoDF11yARtCQVgfUDMWCg==", d: "Aso Math", tier: "flash", prem: true },
      { n: "LxwdLhkUFUhACEQ8CBNGH1ZAUyQ=", d: "Aso Code", tier: "code", prem: false },
      { n: "LxYCNQVLF08DUkQqCwNRUx1URCQW", d: "Aso Super", tier: "ultra", prem: false },
      { n: "LBoCNVxPSg8bTA8tAhI=", d: "Aso Multi", tier: "ultra", prem: true, caps: ["V", "S", "D", "W"] },
    ],
  },
  // gateway B — 2 модели
  {
    e: "KQcbKgIDVw5PEQBxDB5PXR5TX24SHzNeVghEQBMGKhMSUR1TWlc1XAw1HEkURFoIBjEU",
    m: [
      { n: "MgcKKhdMFg5dFQwvSkQNBR1UWiAAB2AXSx1E", d: "Aso", tier: "flash", prem: false, caps: ["V"] },
      { n: "LwUGPhhYV09LDAYrFRhNHwMfQy0HHTtcDE0RTEwIalIVGVRCV1M=", d: "Aso Ultra", tier: "ultra", prem: true },
    ],
  },
] as const;

/** Флаг: использовать прямой канал (true). Всегда true — приложение автономно. */
export const DIRECT_CHANNEL = true;