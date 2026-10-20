/**
 * Резервное копирование данных: экспорт ВСЕГО одним файлом (JSON),
 * импорт из файла. Экспорт — это настоящий файл (не текст в буфере обмена):
 *  - сессии и их сообщения (AsyncStorage "aso_sessions")
 *  - активная сессия, тема, язык
 *  - кастомные провайдеры и их модели (SecureStore "aso_custom_providers")
 *  - Vibe-проекты (AsyncStorage "vibe:projects", "vibe:msgs:<id>")
 *  - файлы Vibe-проектов (documentDirectory/vibe/<id>/…)
 *  - агентское: память (aso_mem_user/aso_mem_memory), задачи (aso_todo),
 *    автозадачи (aso_cron_jobs)
 *  - Hermes-паритет: конфиг агента, тулcеты, голос, kanban, MCP, webhooks,
 *    usage, куратор (pinned/last), безопасность
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
const MEM_USER = "aso_mem_user";
const MEM_MEMORY = "aso_mem_memory";
const TODO_KEY = "aso_todo";
const CRON_KEY = "aso_cron_jobs";
const AGENT_CONFIG_KEY = "aso_agent_config";
const TOOLSETS_KEY = "aso_toolsets_overrides";
const VOICE_KEY = "aso_voice_config";
const KANBAN_KEY = "aso_kanban_tasks";
const MCP_KEY = "aso_mcp_servers";
const WEBHOOK_KEY = "aso_webhooks";
const USAGE_KEY = "aso_usage";
const CURATOR_PINNED = "aso_curator_pinned";
const CURATOR_LAST = "aso_curator_last";
const SECURITY_KEY = "aso_security_config";

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
  memUser: unknown;
  memMemory: unknown;
  todos: unknown;
  cronJobs: unknown;
  agentConfig: unknown;
  toolsets: unknown;
  voice: unknown;
  kanban: unknown;
  mcp: unknown;
  webhooks: unknown;
  usage: unknown;
  curatorPinned: unknown;
  curatorLast: string | null;
  security: unknown;
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
/** Провайдеры без секретов: структура остаётся, apiKey вырезается. */
function redactProviders(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((p: any) => {
      if (!p || typeof p !== "object") return p;
      const { apiKey, ...rest } = p;
      const models = Array.isArray(rest.models)
        ? rest.models.map((m: any) => {
            if (!m || typeof m !== "object") return m;
            const { apiKey: _mk, ...mrest } = m;
            return mrest;
          })
        : rest.models;
      return { ...rest, models, hasKey: !!apiKey };
    });
  } catch {
    return [];
  }
}

export async function collectBackup(): Promise<BackupData> {
  const [
    sessionsRaw,
    activeRaw,
    themeRaw,
    langRaw,
    providersRaw,
    projectsRaw,
    memUserRaw,
    memMemoryRaw,
    todosRaw,
    cronRaw,
    agentConfigRaw,
    toolsetsRaw,
    voiceRaw,
    kanbanRaw,
    mcpRaw,
    webhooksRaw,
    usageRaw,
    curatorPinnedRaw,
    curatorLastRaw,
    securityRaw,
  ] = await Promise.all([
    AsyncStorage.getItem(KEYS_SESSIONS),
    AsyncStorage.getItem(KEYS_ACTIVE),
    AsyncStorage.getItem(KEYS_THEME),
    AsyncStorage.getItem(KEYS_LANG),
    SecureStore.getItemAsync(KEYS_PROVIDERS),
    AsyncStorage.getItem(VIBE_PROJECTS),
    AsyncStorage.getItem(MEM_USER),
    AsyncStorage.getItem(MEM_MEMORY),
    AsyncStorage.getItem(TODO_KEY),
    AsyncStorage.getItem(CRON_KEY),
    AsyncStorage.getItem(AGENT_CONFIG_KEY),
    AsyncStorage.getItem(TOOLSETS_KEY),
    AsyncStorage.getItem(VOICE_KEY),
    AsyncStorage.getItem(KANBAN_KEY),
    AsyncStorage.getItem(MCP_KEY),
    AsyncStorage.getItem(WEBHOOK_KEY),
    AsyncStorage.getItem(USAGE_KEY),
    AsyncStorage.getItem(CURATOR_PINNED),
    AsyncStorage.getItem(CURATOR_LAST),
    AsyncStorage.getItem(SECURITY_KEY),
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
    // Ключи API в бэкап НЕ попадают: файл уходит в Download и в системный
    // Share, то есть доступен любому приложению с доступом к файлам. Ни
    // провайдеров без ключей, ни ключей без провайдеров пользователю не нужно.
    customProviders: redactProviders(providersRaw),
    vibeProjects: projects,
    vibeMessages,
    vibeFiles,
    memUser: memUserRaw ? JSON.parse(memUserRaw) : [],
    memMemory: memMemoryRaw ? JSON.parse(memMemoryRaw) : [],
    todos: todosRaw ? JSON.parse(todosRaw) : [],
    cronJobs: cronRaw ? JSON.parse(cronRaw) : [],
    agentConfig: agentConfigRaw ? JSON.parse(agentConfigRaw) : null,
    toolsets: toolsetsRaw ? JSON.parse(toolsetsRaw) : {},
    voice: voiceRaw ? JSON.parse(voiceRaw) : null,
    kanban: kanbanRaw ? JSON.parse(kanbanRaw) : [],
    mcp: mcpRaw ? JSON.parse(mcpRaw) : [],
    webhooks: webhooksRaw ? JSON.parse(webhooksRaw) : [],
    usage: usageRaw ? JSON.parse(usageRaw) : {},
    curatorPinned: curatorPinnedRaw ? JSON.parse(curatorPinnedRaw) : [],
    curatorLast: curatorLastRaw,
    security: securityRaw ? JSON.parse(securityRaw) : null,
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
    // провайдеры (SecureStore) — ключи в бэкапе вырезаны, поэтому не
    // затираем текущие: мержим по id провайдера и модели.
    if (data.customProviders) {
      let incoming: any[] = Array.isArray(data.customProviders) ? data.customProviders : [];
      try {
        const cur = JSON.parse((await SecureStore.getItemAsync(KEYS_PROVIDERS)) ?? "[]");
        if (Array.isArray(cur)) {
          incoming = incoming.map((p: any) => {
            const oldP = cur.find((c: any) => c && p && c.id === p.id);
            const models = Array.isArray(p?.models)
              ? p.models.map((m: any) => {
                  const oldM = oldP?.models?.find?.((x: any) => x && m && x.id === m.id);
                  return m?.apiKey ? m : { ...m, apiKey: oldM?.apiKey ?? m?.apiKey ?? null };
                })
              : p?.models;
            return { ...p, apiKey: p?.apiKey ?? oldP?.apiKey ?? null, models };
          });
        }
      } catch {}
      await SecureStore.setItemAsync(KEYS_PROVIDERS, JSON.stringify(incoming));
    }
    // агентское: память / задачи / автозадачи
    if (data.memUser) await AsyncStorage.setItem(MEM_USER, JSON.stringify(data.memUser));
    if (data.memMemory) await AsyncStorage.setItem(MEM_MEMORY, JSON.stringify(data.memMemory));
    if (data.todos) await AsyncStorage.setItem(TODO_KEY, JSON.stringify(data.todos));
    if (data.cronJobs) await AsyncStorage.setItem(CRON_KEY, JSON.stringify(data.cronJobs));
    // Hermes-паритет: конфиг агента, тулcеты, голос, kanban, MCP, webhooks, usage, куратор
    if (data.agentConfig) await AsyncStorage.setItem(AGENT_CONFIG_KEY, JSON.stringify(data.agentConfig));
    if (data.toolsets) await AsyncStorage.setItem(TOOLSETS_KEY, JSON.stringify(data.toolsets));
    if (data.voice) await AsyncStorage.setItem(VOICE_KEY, JSON.stringify(data.voice));
    if (data.kanban) await AsyncStorage.setItem(KANBAN_KEY, JSON.stringify(data.kanban));
    if (data.mcp) await AsyncStorage.setItem(MCP_KEY, JSON.stringify(data.mcp));
    if (data.webhooks) await AsyncStorage.setItem(WEBHOOK_KEY, JSON.stringify(data.webhooks));
    if (data.usage) await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(data.usage));
    if (data.curatorPinned) await AsyncStorage.setItem(CURATOR_PINNED, JSON.stringify(data.curatorPinned));
    if (typeof data.curatorLast === "string" && data.curatorLast) await AsyncStorage.setItem(CURATOR_LAST, data.curatorLast);
    if (data.security) await AsyncStorage.setItem(SECURITY_KEY, JSON.stringify(data.security));
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

/**
 * Полная очистка данных устройства.
 * Раньше экран настроек тёр только 5 ключей из ~20 — память, задачи,
 * cron, kanban, MCP, вебхуки, usage и настройки оставались жить.
 */
export async function wipeAllData(): Promise<void> {
  const keys = [
    KEYS_SESSIONS, KEYS_ACTIVE, KEYS_THEME, KEYS_LANG, VIBE_PROJECTS,
    MEM_USER, MEM_MEMORY, TODO_KEY, CRON_KEY, AGENT_CONFIG_KEY, TOOLSETS_KEY,
    VOICE_KEY, KANBAN_KEY, MCP_KEY, WEBHOOK_KEY, USAGE_KEY,
    CURATOR_PINNED, CURATOR_LAST, SECURITY_KEY, "aso_onboarding_done",
  ];
  for (const k of keys) { try { await AsyncStorage.removeItem(k); } catch {} }
  try {
    const all = await AsyncStorage.getAllKeys();
    const extra = all.filter((k) => k.startsWith(VIBE_MSGS_PREFIX));
    for (const k of extra) { try { await AsyncStorage.removeItem(k); } catch {} }
  } catch {}
  for (const k of [KEYS_PROVIDERS, "aso_token", "aso_device"]) {
    try { await SecureStore.deleteItemAsync(k); } catch {}
  }
  try {
    const vibe = new Directory(Paths.document, "vibe");
    if (vibe.exists) vibe.delete();
  } catch {}
}
