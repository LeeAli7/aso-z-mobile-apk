/**
 * security.ts — безопасность (Hermes: security/redact_secrets/website_blocklist).
 *
 * Экран отдела «Безопасность» лёг на эти ключи: скрытие секретов в логах,
 * блок-лист сайтов, подтверждение опасных команд.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SecurityConfig {
  /** Скрывать секреты/ключи в выводах и логах (Hermes: security.redact_secrets). */
  redactSecrets: boolean;
  /** Требовать подтверждение опасных команд rm -rf и т.п. */
  confirmDangerous: boolean;
  /** Блок-лист сайтов (Hermes: security.website_blocklist), по одному на строку в UI. */
  websiteBlocklist: string[];
}

const KEY = "aso_security_config";

/** Legacy-ключ SettingsScreen (Фаза 1: единый стор читает его, пока UI на нём пишет). */
const LEGACY_REDACT_KEY = "aso_redact_secrets";

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  redactSecrets: true,
  confirmDangerous: true,
  websiteBlocklist: [],
};

export async function loadSecurity(): Promise<SecurityConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const base = { ...DEFAULT_SECURITY_CONFIG };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        Object.assign(base, parsed);
        base.websiteBlocklist = Array.isArray((parsed as any)?.websiteBlocklist)
          ? (parsed as any).websiteBlocklist.filter((x: unknown) => typeof x === "string")
          : [];
      } catch {}
    } else {
      // Фаза 1: JSON-конфига нет — подхватываем legacy-ключ UI.
      try {
        const legacy = await AsyncStorage.getItem(LEGACY_REDACT_KEY);
        if (legacy !== null) base.redactSecrets = legacy !== "0";
      } catch {}
    }
    return base;
  } catch {
    return { ...DEFAULT_SECURITY_CONFIG };
  }
}

export async function saveSecurity(patch: Partial<SecurityConfig>): Promise<SecurityConfig> {
  const cur = await loadSecurity();
  const next: SecurityConfig = { ...cur, ...patch };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  // Фаза 1: зеркалим redact в legacy-ключ — UI видит то же.
  try {
    await AsyncStorage.setItem(LEGACY_REDACT_KEY, next.redactSecrets ? "1" : "0");
  } catch {}
  return next;
}

/** Проверка URL против блок-листа (подстрока в хосте). */
export function isBlockedUrl(url: string, blocklist: string[]): boolean {
  const u = url.trim().toLowerCase();
  if (!u) return false;
  return blocklist.some((b) => {
    const rule = b.trim().toLowerCase();
    return !!rule && u.includes(rule);
  });
}
