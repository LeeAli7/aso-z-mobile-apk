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
 *  2) Открываем Termux и запускаем `cd` в эту папку.
 *
 * Фиксы (v1.6):
 *  - Файлы копируются с ПРАВИЛЬНЫМ расширением (index.html → index.html,
 *    а НЕ index.html.txt) — mime-тип выводится из имени файла.
 *  - Для каждого проекта создаётся СВОЯ подпапка Download/AsoVibe/<id> —
 *    проекты не смешиваются.
 *  - Если сохранённый SAF-URI протух (SecurityException после перезапуска),
 *    снова просим выбрать папку и повторяем экспорт — без краша.
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

/** MIME по расширению — чтобы SAF не дописывал .txt к html/js/css. */
function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html", htm: "text/html", css: "text/css",
    js: "text/javascript", mjs: "text/javascript", ts: "text/x-typescript",
    tsx: "text/x-typescript", jsx: "text/jsx", json: "application/json",
    md: "text/markdown", txt: "text/plain", text: "text/plain",
    csv: "text/csv", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml",
    py: "text/x-python", sh: "text/x-sh", bash: "text/x-sh",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", ico: "image/x-icon",
    pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
    wasm: "application/wasm", sql: "application/sql", go: "text/x-go",
    rs: "text/x-rust", c: "text/x-c", h: "text/x-c", cpp: "text/x-c++",
    hpp: "text/x-c++", java: "text/x-java", rb: "text/x-ruby", php: "text/x-php",
    lock: "text/plain", toml: "text/toml", ini: "text/plain", env: "text/plain",
    gitignore: "text/plain", dockerfile: "text/plain",
  };
  return map[ext] ?? "text/plain";
}

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

/** Спрашивает папку у юзера, сохраняет URI. */
async function pickDir(): Promise<string> {
  const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted || !perm.directoryUri) {
    throw new Error("Нужно выбрать папку для экспорта (например Download)");
  }
  const uri = perm.directoryUri.endsWith("/") ? perm.directoryUri.slice(0, -1) : perm.directoryUri;
  await setSafUri(uri);
  return uri;
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
    let dirUri: string = (await getSafUri()) ?? "";
    if (!dirUri) {
      dirUri = await pickDir();
    }

    const copy = async (rootUri: string) => {
      // создаём AsoVibe/<projectId>
      const root = rootUri.endsWith("/") ? rootUri.slice(0, -1) : rootUri;
      let shareDir = root + "/" + SHARE_DIR_NAME;
      try {
        await StorageAccessFramework.readDirectoryAsync(shareDir);
      } catch {
        shareDir = await StorageAccessFramework.makeDirectoryAsync(root, SHARE_DIR_NAME);
      }
      let projDir = shareDir + "/" + projectId;
      try {
        await StorageAccessFramework.readDirectoryAsync(projDir);
      } catch {
        projDir = await StorageAccessFramework.makeDirectoryAsync(shareDir, projectId);
      }

      // Гарантируем, что папка существует (SAF-аналог mkdir -p).
      const ensureDir = async (dirUri: string): Promise<string> => {
        try {
          await StorageAccessFramework.readDirectoryAsync(dirUri);
          return dirUri;
        } catch {
          const parent = dirUri.slice(0, dirUri.lastIndexOf("/"));
          const name = dirUri.slice(dirUri.lastIndexOf("/") + 1);
          const created = await StorageAccessFramework.makeDirectoryAsync(parent, name);
          return created;
        }
      };

      // Удаляем файл, если он уже существует (иначе createFileAsync
      // плодит дубли и/или кидает SecurityException при перезаписи).
      const removeIfExists = async (dirUri: string, name: string) => {
        try {
          const entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
          const hit = entries.find((u) => decodeURIComponent(u.split("/").pop() || "") === name);
          if (hit) {
            await StorageAccessFramework.deleteAsync(hit);
          }
        } catch {}
      };

      // копируем все файлы проекта с СОХРАНЕНИЕМ структуры папок
      const files = await listFiles(projectId);
      let copied = 0;
      let skipped = 0;
      for (const f of files) {
        const rel = f.name; // например "src/App.tsx"
        const segments = rel.split("/").filter(Boolean);
        const fileName = segments.pop();
        if (!fileName) continue;
        try {
          // создаём вложенные папки
          let curDir = projDir;
          for (const seg of segments) {
            curDir = await ensureDir(curDir + "/" + seg);
          }
          await removeIfExists(curDir, fileName);
          const fileUri = await StorageAccessFramework.createFileAsync(
            curDir,
            fileName,
            mimeFor(fileName),
          );
          const content = await readFile(projectId, rel);
          await StorageAccessFramework.writeAsStringAsync(fileUri, content);
          copied++;
        } catch (e: any) {
          const msg = String(e?.message || e).toLowerCase();
          if (msg.includes("permission") || msg.includes("security")) {
            throw e; // пробросим — выше перезапросим папку
          }
          skipped++;
        }
      }
      return { copied, skipped };
    };

    let res = { copied: 0, skipped: 0 };
    try {
      res = await copy(dirUri);
    } catch (e: any) {
      // SecurityException / протухший URI — перезапрашиваем папку и ретраим один раз
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes("permission") || msg.includes("security") || msg.includes("no such")) {
        dirUri = await pickDir();
        res = await copy(dirUri);
      } else {
        throw e;
      }
    }

    return {
      ok: true,
      message: res.copied > 0
        ? `Экспортировано файлов: ${res.copied}${res.skipped ? ` (пропущено ${res.skipped})` : ""} → Download/${SHARE_DIR_NAME}/${projectId}`
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
 * 2) запускаем Termux сразу в папке проекта через com.termux.RUN_COMMAND
 *    (WORKDIR + bash), если Termux разрешил внешние команды;
 *    иначе fallback: TermuxActivity + подсказка cd.
 */
export async function openInTermux(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Termux доступен только на Android" };
  }
  const exp = await exportProjectToShared(projectId);
  if (!exp.ok) return exp;

  const projectPath = `/storage/emulated/0/Download/${SHARE_DIR_NAME}/${projectId}`;
  const termuxDir = `/data/data/com.termux/files/home/storage/shared/Download/${SHARE_DIR_NAME}/${projectId}`;

  try {
    // Пытаемся открыть Termux сразу в директории проекта.
    // Требует в Termux: Настройки → "Разрешить внешним приложениям выполнять команды".
    await IntentLauncher.startActivityAsync("com.termux.RUN_COMMAND", {
      packageName: "com.termux",
      className: "com.termux.app.RunCommandService",
      extra: {
        "com.termux.RUN_COMMAND_PATH": "/data/data/com.termux/files/usr/bin/bash",
        "com.termux.RUN_COMMAND_ARGUMENTS": ["-c", `cd "${termuxDir}" && exec bash`],
        "com.termux.RUN_COMMAND_WORKDIR": termuxDir,
        "com.termux.RUN_COMMAND_BACKGROUND": false,
        "com.termux.RUN_COMMAND_SESSION_ACTION": "0",
      },
    });
    return {
      ok: true,
      message: `Termux открыт в папке проекта: Download/${SHARE_DIR_NAME}/${projectId}`,
    };
  } catch (e: any) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("not found") || msg.includes("no activity") || msg.includes("unable to find")) {
      return { ok: false, message: "Termux не установлен. Поставь его из F-Droid: https://f-droid.org/packages/com.termux/" };
    }
    // RUN_COMMAND не разрешён — fallback на обычный запуск + подсказка.
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
        packageName: "com.termux",
        className: "com.termux.app.TermuxActivity",
      });
      const cd = `cd ~/storage/shared/Download/${SHARE_DIR_NAME}/${projectId}`;
      return {
        ok: true,
        message: `Termux запущен. Включи «Разрешить внешним приложениям выполнять команды» в настройках Termux, чтобы он открывался сразу в проекте.\nПока — выполни вручную:\n${cd}`,
      };
    } catch (e2: any) {
      const m2 = String(e2?.message || e2).toLowerCase();
      if (m2.includes("not found") || m2.includes("no activity") || m2.includes("unable to find")) {
        return { ok: false, message: "Termux не установлен. Поставь его из F-Droid: https://f-droid.org/packages/com.termux/" };
      }
      return { ok: false, message: String(e2?.message || e2) };
    }
  }
}

/**
 * Открыть папку проекта в системном файловом менеджере.
 * Экспортируем в Download/AsoVibe/<id> и открываем ИМЕННО эту папку
 * (DocumentsUI принимает content://…/document/primary:Download/AsoVibe/<id>).
 */
export async function openFolderInFileManager(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Открытие папки доступно только на Android" };
  }
  const exp = await exportProjectToShared(projectId);
  if (!exp.ok) return exp;

  try {
    // Прямой URI папки проекта в DocumentsUI
    const docUri =
      "content://com.android.externalstorage.documents/document/primary%3ADownload%2F" +
      encodeURIComponent(SHARE_DIR_NAME) + "%2F" + encodeURIComponent(projectId);
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: docUri,
      type: "*/*",
      flags: 1,
      packageName: "com.android.documentsui",
      className: "com.android.documentsui.files.FilesActivity",
    });
    return {
      ok: true,
      message: `Файловый менеджер открыт: Download/${SHARE_DIR_NAME}/${projectId}`,
    };
  } catch (e: any) {
    // DocumentsUI не найден — fallback на общий корень
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: "content://com.android.externalstorage.documents/root/primary",
        flags: 1,
      });
      return {
        ok: true,
        message: `Файловый менеджер открыт (корень). Проект: Download/${SHARE_DIR_NAME}/${projectId}`,
      };
    } catch (e2: any) {
      return { ok: false, message: String(e2?.message || e2) };
    }
  }
}
