/**
 * Интеграция с Termux и файловым менеджером.
 *
 * Termux — отдельное Android-приложение с настоящим shell (npm/pip/python).
 * Он НЕ видит закрытое хранилище приложения (Android/data/...), поэтому
 * чтобы «открыть проект в Termux» по-настоящему, мы:
 *
 *  1) Экспортируем проект в общее хранилище: Download/AsoVibe/<projectId>/
 *     (через StorageAccessFramework — юзер выбирает папку один раз,
 *      сохраняем URI; дальше копируем автоматически).
 *  2) Открываем Termux и запускаем `cd` в эту папку (RUN_COMMAND / TermuxActivity).
 *
 * Также: кнопка «Открыть в файловом менеджере» — открывает общий путь
 * в системном менеджере (там проект реально виден).
 *
 * На web — no-op с понятным сообщением.
 */
import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import { listFiles, readFile } from "./vibeLocal";

const SAF_URI_KEY = "aso_saf_vibe_dir";
const SHARE_DIR_NAME = "AsoVibe";

/** Путь к папке проекта в хранилище приложения. */
export function projectDirPath(projectId: string): string {
  return `${Paths.document}/vibe/${projectId}/`;
}

/** Можно ли вообще запускать нативные интенты (только Android). */
export function nativeIntentsSupported(): boolean {
  return Platform.OS === "android";
}

async function getSafUri(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SAF_URI_KEY);
  } catch {
    return null;
  }
}

async function setSafUri(uri: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAF_URI_KEY, uri);
  } catch {}
}

/**
 * Экспорт проекта в общее хранилище (Download/AsoVibe/<projectId>).
 * Возвращает путь в файловой системе (для Termux) или content:// URI.
 */
export async function exportProjectToShared(
  projectId: string,
): Promise<{ ok: boolean; message: string; path?: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Экспорт доступен только на Android" };
  }
  try {
    let dirUri: string = await getSafUri() ?? "";
    if (!dirUri) {
      // первый раз — просим юзера выбрать папку (обычно Download)
      const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted || !perm.directoryUri) {
        return { ok: false, message: "Нужно выбрать папку для экспорта (например Download)" };
      }
      dirUri = perm.directoryUri;
      await setSafUri(dirUri);
    }
    

    // создаём AsoVibe/<projectId>
    const rootUri = dirUri.endsWith("/") ? dirUri.slice(0, -1) : dirUri;
    let shareDir = rootUri + "/" + SHARE_DIR_NAME;
    try {
      const info = await StorageAccessFramework.readDirectoryAsync(shareDir);
      void info;
    } catch {
      shareDir = await StorageAccessFramework.makeDirectoryAsync(rootUri, SHARE_DIR_NAME);
    }
    let projDir = shareDir + "/" + projectId;
    try {
      const info = await StorageAccessFramework.readDirectoryAsync(projDir);
      void info;
    } catch {
      projDir = await StorageAccessFramework.makeDirectoryAsync(shareDir, projectId);
    }

    // копируем все файлы проекта
    const files = await listFiles(projectId);
    let copied = 0;
    for (const f of files) {
      try {
        const content = await readFile(projectId, f.name);
        const fileName = f.name.split("/").pop() || f.name;
        const fileUri = await StorageAccessFramework.createFileAsync(
          projDir,
          fileName,
          "text/plain",
        );
        await StorageAccessFramework.writeAsStringAsync(fileUri, content);
        copied++;
      } catch {}
    }

    return {
      ok: true,
      message: copied > 0
        ? `Экспортировано файлов: ${copied} → Download/${SHARE_DIR_NAME}/${projectId}`
        : "Папка проекта создана (файлов пока нет)",
      path: `/storage/emulated/0/Download/${SHARE_DIR_NAME}/${projectId}`,
    };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}

/**
 * Открыть проект в Termux.
 * 1) экспортируем в Download/AsoVibe/<id> (если ещё не выбран каталог — SAF-диалог);
 * 2) запускаем Termux (если установлен) — юзер видит shell в папке проекта.
 */
export async function openInTermux(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Termux доступен только на Android" };
  }
  const exp = await exportProjectToShared(projectId);
  if (!exp.ok) return exp;

  try {
    // Запускаем Termux; затем показываем путь.
    await IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
      packageName: "com.termux",
      className: "com.termux.app.TermuxActivity",
      extra: {},
    });
    const cd = exp.path
      ? `cd ~/storage/shared/Download/${SHARE_DIR_NAME}/${projectId}`
      : "";
    return {
      ok: true,
      message: cd
        ? `Termux запущен. Внутри выполни:\n${cd}\n(файлы проекта уже там)`
        : "Termux запущен",
    };
  } catch (e: any) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("not found") || msg.includes("no activity") || msg.includes("unable to find")) {
      return { ok: false, message: "Termux не установлен. Поставь его из F-Droid: https://f-droid.org/packages/com.termux/" };
    }
    return { ok: false, message: String(e?.message || e) };
  }
}

/**
 * Открыть папку проекта в системном файловом менеджере.
 * Экспортируем в Download/AsoVibe/<id> и открываем этот путь.
 */
export async function openFolderInFileManager(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Открытие папки доступно только на Android" };
  }
  const exp = await exportProjectToShared(projectId);
  if (!exp.ok) return exp;

  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: "content://com.android.externalstorage.documents/root/primary",
      flags: 1,
    });
    return {
      ok: true,
      message: `Файловый менеджер открыт. Проект: Download/${SHARE_DIR_NAME}/${projectId}`,
    };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}
