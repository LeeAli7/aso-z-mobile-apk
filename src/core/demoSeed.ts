/**
 * demoSeed.ts — демо-данные для скриншот-прохода (Hermes-паритет, dd69d22).
 *
 * Кейз инжектит через evaluateOnNewDocument ПЕРЕД goto: ключи AsyncStorage
 * на web = localStorage, имена 1:1. Форматы — под то, что читают ЭКРАНЫ
 * (KanbanScreen/ConnectorsScreen — свои локальные типы, не движковые).
 *
 * В проде не вызывается сам — только руками из скрин-скрипта:
 *   localStorage.setItem(key, SEED[key]) для всех ключей SEED.
 * Или внутри приложения: await seedDemoData().
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const NOW = Date.now();
const H = 3_600_000;

/** Готовые пары key → JSON-строка для инжекта в localStorage. */
export const SEED: Record<string, string> = {
  // ── Сессии чата (AppStore KEYS.sessions/active) ──
  aso_sessions: JSON.stringify([
    {
      id: "demo-s1",
      name: "План поездки",
      messages: [
        { id: "m1", role: "user", content: "Составь план поездки на выходные" },
        { id: "m2", role: "assistant", content: "Вот план: день 1 — дорога и заселение, день 2 — прогулка и музей." },
      ],
      modelId: null,
      createdAt: NOW - 2 * H,
      updatedAt: NOW - H,
    },
    {
      id: "demo-s2",
      name: "Рецепт плова",
      messages: [
        { id: "m3", role: "user", content: "Дай рецепт плова" },
        { id: "m4", role: "assistant", content: "Рис, морковь, мясо, зира. Обжарь, залей водой, томи 40 минут." },
      ],
      modelId: null,
      createdAt: NOW - 5 * H,
      updatedAt: NOW - 4 * H,
    },
  ]),
  aso_active: "demo-s1",

  // ── Vibe-проекты (vibeLocal PROJECTS_KEY, формат движка) ──
  "vibe:projects": JSON.stringify([
    { id: "demo-p1", name: "Демо-проект", desc: "пример для скрина", createdAt: NOW - 3 * H, updatedAt: NOW - H },
    { id: "demo-p2", name: "Заметки", desc: "", createdAt: NOW - 6 * H, updatedAt: NOW - 5 * H },
  ]),

  // ── Kanban: формат KanbanScreen {id,title,assignee,col} ──
  aso_kanban_tasks: JSON.stringify([
    { id: "kb1", title: "Собрать релиз", assignee: "Марсель", col: "doing" },
    { id: "kb2", title: "Проверить tsc", assignee: "Арес", col: "todo" },
    { id: "kb3", title: "Скрины 390x844", assignee: "Кейз", col: "todo" },
    { id: "kb4", title: "Хранилище сведено", assignee: "Марсель", col: "done" },
  ]),

  // ── Коннекторы: форматы ConnectorsScreen ──
  aso_mcp_servers: JSON.stringify([
    { id: "mcp1", name: "Файлы", target: "stdio: files-mcp" },
    { id: "mcp2", name: "Веб", target: "http://localhost:8000/mcp" },
  ]),
  aso_webhooks: JSON.stringify([
    { id: "wh1", name: "Пуш билда", events: "build.done" },
  ]),

  // ── Задачи (todo.ts формат) ──
  aso_todo: JSON.stringify([
    { id: "t1", content: "Добить отделы-подокна", status: "in_progress", createdAt: NOW - 2 * H, updatedAt: NOW - H },
    { id: "t2", content: "Снять скрины", status: "pending", createdAt: NOW - H, updatedAt: NOW - H },
  ]),

  // ── Автозадачи (cron.ts формат) ──
  aso_cron_jobs: JSON.stringify([
    {
      id: "c1",
      name: "Утренний дайджест",
      schedule: "0 9 * * *",
      prompt: "Собери новости за ночь",
      enabled: true,
      lastRunAt: NOW - 12 * H,
      createdAt: NOW - 24 * H,
      deliver: "chat",
      lastResult: "Дайджест собран: 5 новостей",
    },
    {
      id: "c2",
      name: "Бэкап",
      schedule: "every 6h",
      prompt: "Экспорт бэкапа",
      enabled: false,
      lastRunAt: null,
      createdAt: NOW - 24 * H,
      deliver: "local",
    },
  ]),

  // ── Память (memory.ts формат) ──
  aso_mem_user: JSON.stringify([
    { id: "mu1", text: "Али — медстудент, русский UI", createdAt: NOW - 24 * H, updatedAt: NOW - 24 * H },
  ]),
  aso_mem_memory: JSON.stringify([
    { id: "mm1", text: "Aso-z mobile: Expo 57, тема Kimi", createdAt: NOW - 20 * H, updatedAt: NOW - 10 * H },
  ]),

  // ── Конфиг агента / голос / тулcеты (движковые форматы) ──
  aso_agent_config: JSON.stringify({
    maxTurns: 90,
    approvalsMode: "smart",
    approvalsTimeoutSec: 120,
    compressionEnabled: true,
    compressionThreshold: 0.5,
    memoryEnabled: true,
    userProfileEnabled: true,
    maxConcurrentChildren: 2,
    curatorEnabled: true,
  }),
  aso_voice_config: JSON.stringify({
    sttEnabled: true,
    sttLang: "ru-RU",
    ttsEnabled: false,
    ttsLang: "ru-RU",
    ttsRate: 1.0,
  }),
  aso_toolsets_overrides: JSON.stringify({ files: true, memory: true, web: true, cron: true }),

  // ── Usage (движковый формат; экран пока на STATS-заглушке — см. отчёт) ──
  aso_usage: JSON.stringify({
    "mimo-v2.5-free": {
      modelKey: "mimo-v2.5-free",
      provider: "opencode",
      promptTokens: 12400,
      completionTokens: 3800,
      totalTokens: 16200,
      calls: 12,
      updatedAt: NOW - H,
    },
  }),

  // ── Legacy-префы Настроек (SettingsScreen PREFS читает их, а не движковые JSON) ──
  aso_agent_max_turns: "90",
  aso_approvals_mode: "smart",
  aso_compression: "1",
  aso_stt_enabled: "1",
  aso_stt_provider: "local",
  aso_tts_provider: "edge",
  aso_memory_enabled: "1",
  aso_redact_secrets: "1",
  aso_delegation_max: "3",
  aso_theme: "dark",
  aso_lang: "ru",
};

/** Залить сид в AsyncStorage изнутри приложения (для ручного прогона). */
export async function seedDemoData(): Promise<void> {
  for (const [k, v] of Object.entries(SEED)) {
    try {
      await AsyncStorage.setItem(k, v);
    } catch {}
  }
}

/** Очистить сид (вернуть пустые списки). */
export async function clearDemoData(): Promise<void> {
  for (const k of Object.keys(SEED)) {
    try {
      await AsyncStorage.removeItem(k);
    } catch {}
  }
}
