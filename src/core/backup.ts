/**
 * Резервное копирование данных: экспорт ВСЕГО одним файлом (JSON),
 * импорт из файла. Экспорт — это настоящий файл (не текст в буфере обмена):
 *  - сессии и их сообщения (AsyncStorage "aso_sessions")
 *  - активная сессия, тема, язык
 *  - кастомные провайдеры и их модели (SecureStore "aso_custom_providers")
 *  - Vibe-проекты (AsyncStorage "vibe:projects", "vibe:msgs:<id>")
 *  - файлы Vibe-проектов (documentDirectory/vibe/<id>/…)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Platform, Share } from "react-native";

const KEYS_SESSIONS = "aso_sessions";
const KEYS_ACTIVE = "aso_active";
const KEYS_THEME = "aso_theme";
const KEYS_LANG = "aso_lang";
const KEYS_PROVIDERS = "aso_custom_providers";
const VIBE_PROJECTS = "vibe:projects";
const VIBE_MSGS_PREFIX = "vibe:msgs:";

const EXPORT_NAME = "aso-z-backup.json";
const EXPORT_MIME = "application/json";

export interface BackupData {
  app: "aso-z";
  version: 1;
  exportedAt: string;
  sessions: unknown;
  activeSessionId: string | null;
  theme: string | null;
  lang: string | null;
  customProviders: unknown;
  vibeProjects: unknown;
  vibeMessages: Record<string, unknown>;
  vibeFiles: Record<string, Record<string, string>>; // projectId -> { relPath: content }
}

function fsSupported(): boolean {
  try {
    const d = new Directory(Paths.document, "vibe");
    return typeof d.exists === "boolean";
  } catch {
    return false;
  }
}

function walkFiles(dir: Directory, prefix: string, acc: Record<string, string>): void {
  for (const item of dir.list()) {
    if (item instanceof File) {
      try {
        acc[prefix + item.name] = item.textSync?.() ?? "";
      } catch {
        // бинарные файлы пропускаем (JSON-бэкап текстовый)
      }
    } else if (item instanceof Directory) {
      walkFiles(item, prefix + item.name + "/", acc);
    }
  }
}

/** Собрать все данные в один объект. */
export async function collectBackup(): Promise<BackupData> {
  const [
    sessionsRaw,
    activeRaw,
    themeRaw,
    langRaw,
    providersRaw,
    projectsRaw,
  ] = await Promise.all([
    AsyncStorage.getItem(KEYS_SESSIONS),
    AsyncStorage.getItem(KEYS_ACTIVE),
    AsyncStorage.getItem(KEYS_THEME),
    AsyncStorage.getItem(KEYS_LANG),
    SecureStore.getItemAsync(KEYS_PROVIDERS),
    AsyncStorage.getItem(VIBE_PROJECTS),
  ]);

  const vibeMessages: Record<string, unknown> = {};
  let projects: any[] = [];
  try {
    projects = JSON.parse(projectsRaw ?? "[]");
  } catch {}

  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (p && p.id) {
        const raw = await AsyncStorage.getItem(VIBE_MSGS_PREFIX + p.id);
        try {
          vibeMessages[p.id] = JSON.parse(raw ?? "[]");
        } catch {
          vibeMessages[p.id] = [];
        }
      }
    }
  }

  const vibeFiles: Record<string, Record<string, string>> = {};
  if (fsSupported() && Array.isArray(projects)) {
    for (const p of projects) {
      if (!p || !p.id) continue;
      const dir = new Directory(new Directory(Paths.document, "vibe"), p.id);
      if (dir.exists) {
        const acc: Record<string, string> = {};
        walkFiles(dir, "", acc);
        if (Object.keys(acc).length) vibeFiles[p.id] = acc;
      }
    }
  }

  return {
    app: "aso-z",
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessionsRaw ? JSON.parse(sessionsRaw) : [],
    activeSessionId: activeRaw || null,
    theme: themeRaw,
    lang: langRaw,
    customProviders: providersRaw ? JSON.parse(providersRaw) : [],
    vibeProjects: projects,
    vibeMessages,
    vibeFiles,
  };
}

/**
 * Экспорт: пишет JSON-файл в Download (через SAF) и показывает его
 * в системном Share как файл. Возвращает человеко-читаемый итог.
 */
export async function exportBackupToFile(): Promise<{ ok: boolean; message: string }> {
  if (Platform.OS !== "android") {
    return { ok: false, message: "Экспорт файлом доступен на Android" };
  }
  try {
    const data = await collectBackup();
    const json = JSON.stringify(data, null, 2);

    const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted || !perm.directoryUri) {
      return { ok: false, message: "Не выбрана папка для экспорта" };
    }
    const dirUri = perm.directoryUri.endsWith("/") ? perm.directoryUri.slice(0, -1) : perm.directoryUri;

    // имя с датой: aso-z-backup-2026-08-06.json
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `aso-z-backup-${stamp}.json`;

    const fileUri = await StorageAccessFramework.createFileAsync(dirUri, name, EXPORT_MIME);
    await StorageAccessFramework.writeAsStringAsync(fileUri, json);

    // показываем файл в системном Share.
    // ВАЖНО: передаём ТОЛЬКО url (без message) — если передать и url и text,
    // на Android многие получатели (Telegram) берут текст, а не файл.
    if (!Share.share) {
      return { ok: true, message: `Сохранено: ${name}` };
    }
    try {
      await Share.share({ url: fileUri });
    } catch {
      // fallback: если share по url не поддержан — хотя бы сообщение
      try {
        await Share.share({ message: `Резервная копия Aso-z сохранена: Download/${name}` });
      } catch {}
    }

    return { ok: true, message: `Сохранено: ${name}` };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}

/** Импорт: выбираем JSON-файл, применяем все данные (с перезаписью). */
export async function importBackupFromFile(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "text/json", "application/octet-stream"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) {
      return { ok: false, message: "Импорт отменён" };
    }
    const asset = res.assets[0];
    const json = await new File(asset.uri).text();
    const data = JSON.parse(json) as BackupData;

    if (data.app !== "aso-z") {
      return { ok: false, message: "Это не файл резервной копии Aso-z" };
    }

    // сессии и активная
    if (Array.isArray(data.sessions)) {
      await AsyncStorage.setItem(KEYS_SESSIONS, JSON.stringify(data.sessions));
    }
    if (typeof data.activeSessionId === "string") {
      await AsyncStorage.setItem(KEYS_ACTIVE, data.activeSessionId);
    }
    // настройки
    if (data.theme === "light" || data.theme === "dark" || data.theme === "system") {
      await AsyncStorage.setItem(KEYS_THEME, data.theme);
    }
    if (data.lang === "ru" || data.lang === "en") {
      await AsyncStorage.setItem(KEYS_LANG, data.lang);
    }
    // провайдеры (SecureStore)
    if (data.customProviders) {
      await SecureStore.setItemAsync(KEYS_PROVIDERS, JSON.stringify(data.customProviders));
    }
    // vibe-проекты
    if (Array.isArray(data.vibeProjects)) {
      await AsyncStorage.setItem(VIBE_PROJECTS, JSON.stringify(data.vibeProjects));
      for (const p of data.vibeProjects) {
        if (!p || !p.id) continue;
        const msgs = data.vibeMessages?.[p.id];
        if (msgs) await AsyncStorage.setItem(VIBE_MSGS_PREFIX + p.id, JSON.stringify(msgs));
        // файлы проекта
        const files = data.vibeFiles?.[p.id];
        if (files && fsSupported()) {
          const dir = new Directory(new Directory(Paths.document, "vibe"), p.id);
          if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
          for (const [rel, content] of Object.entries(files)) {
            const parts = rel.split("/").filter(Boolean);
            const fileName = parts.pop();
            if (!fileName) continue;
            let cur = dir;
            for (const seg of parts) {
              const next = new Directory(cur, seg);
              if (!next.exists) next.create({ idempotent: true, intermediates: true });
              cur = next;
            }
            const f = new File(cur, fileName);
            if (!f.exists) f.create({ intermediates: true });
            await f.write(content);
          }
        }
      }
    }

    return {
      ok: true,
      message: `Импортировано: ${Array.isArray(data.sessions) ? data.sessions.length : 0} сессий, ${Array.isArray(data.vibeProjects) ? data.vibeProjects.length : 0} проектов`,
    };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}
