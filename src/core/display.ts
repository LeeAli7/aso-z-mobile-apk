/**
 * display.ts — внешний вид (Hermes: display/theme/language).
 *
 * Тонкая обёртка над теми же ключами, что использует AppStore
 * (aso_theme, aso_lang) — чтобы экран отдела «Внешний вид» лёг на готовые ключи.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeName = "light" | "dark" | "system";
export type Lang = "ru" | "en";

const THEME_KEY = "aso_theme";
const LANG_KEY = "aso_lang";

export async function loadDisplay(): Promise<{ theme: ThemeName; lang: Lang }> {
  try {
    const [th, lg] = await Promise.all([AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(LANG_KEY)]);
    return {
      theme: th === "light" || th === "dark" || th === "system" ? th : "system",
      lang: lg === "ru" || lg === "en" ? lg : "ru",
    };
  } catch {
    return { theme: "system", lang: "ru" };
  }
}

export async function saveDisplay(patch: { theme?: ThemeName; lang?: Lang }): Promise<void> {
  try {
    if (patch.theme) await AsyncStorage.setItem(THEME_KEY, patch.theme);
    if (patch.lang) await AsyncStorage.setItem(LANG_KEY, patch.lang);
  } catch {}
}
