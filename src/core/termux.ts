/**
 * Интеграция с рантаймом и файловым менеджером.
 *
 * Рантайм ВСТРОЕН в приложение (Termux bootstrap, см. modules/aso-runtime):
 * единое хранилище внутри приватной директории, shell-сессия = дочерний
 * процесс с pipe. Внешний Termux через Intent больше не нужен.
 *
 * Вспомогательно: экспорт проекта в Download/AsoVibe/<projectId>/ через SAF —
 * чтобы юзер мог руками закинуть/забрать файлы системным менеджером
 * (не основной путь, а опциональная функция).
 *
 * На web — no-op с понятным сообщением.
 */
import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import { listFiles, readFile } from "./vibeLocal";
import { ensureRuntime, runtimeAvailable } from "./runtime";

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
 * Открыть терминал в папке проекта.
 *
 * Рантайм ВСТРОЕН: при первом вызове устанавливает Termux bootstrap
 * (распаковка assets → files/data/usr), затем запускает bash-сессию
 * с cwd = папка проекта. Возвращает ok — дальше команды [CMD:] в чате
 * выполняются уже в рантайме.
 */
export async function openInTermux(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (!nativeIntentsSupported()) {
    return { ok: false, message: "Терминал доступен только на Android" };
  }
  if (!runtimeAvailable()) {
    return { ok: false, message: "Встроенный рантайм не доступен на этом устройстве" };
  }
  const r = await ensureRuntime();
  if (!r.ok) {
    return { ok: false, message: r.message };
  }
  return {
    ok: true,
    message: "Встроенный терминал готов. Опиши задачу в чате — агент выполнит команды (apk/apt, python, bash).",
  };
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
