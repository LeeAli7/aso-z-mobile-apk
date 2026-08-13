/**
 * runtime.ts — мост приложения к встроенному Linux-рантайму (aso-runtime).
 *
 * На Android: настоящий Termux bootstrap (bash, apt, python…) — см. modules/aso-runtime.
 * На web/iOS: no-op (рантайм физически в APK, только Android).
 *
 * Агент выполняет команды блоками [CMD: команда] — здесь же стримится вывод.
 */
import { Platform } from "react-native";
import {
  isAvailable as rtAvailable,
  isInstalled as rtInstalled,
  installBootstrap,
  exec as rtExec,
  execCapture as rtExecCapture,
  kill as rtKill,
  getRuntimeMode as rtMode,
  onOutput,
  onExit,
} from "../../modules/aso-runtime/src";
import { writeFile } from "./vibeLocal";

export interface RuntimeHandle {
  sessionId: number;
  pid: number;
  error?: string;
}

export type OutputListener = (sessionId: number, data: string) => void;
export type ExitListener = (sessionId: number, code: number) => void;

export function runtimeAvailable(): boolean {
  return Platform.OS === "android" && rtAvailable();
}

/** Текущий режим рантайма: "proot" | "bootstrap" | "toybox" | null (не известен). */
export function runtimeMode(): string | null {
  if (!runtimeAvailable()) return null;
  try {
    return rtMode() ?? null;
  } catch {
    return null;
  }
}

/**
 * Инициализировать рантайм при первом запуске (идемпотентно).
 * Мемоизируем промис — параллельные вызовы не запускают вторую распаковку.
 * При сбое сбрасываем кэш, чтобы следующая попытка могла повториться.
 */
let installPromise: Promise<{ ok: boolean; message: string }> | null = null;

export function ensureRuntime(): Promise<{ ok: boolean; message: string }> {
  if (!runtimeAvailable()) {
    return Promise.resolve({ ok: false, message: "Встроенный рантайм доступен только на Android" });
  }
  if (!installPromise) {
    installPromise = (async () => {
      try {
        if (await rtInstalled()) return { ok: true, message: "Рантайм установлен" };
        const prefix = await installBootstrap();
        return { ok: true, message: `Рантайм готов: ${prefix}` };
      } catch (e: any) {
        installPromise = null; // даём возможность повторить при следующем вызове
        return { ok: false, message: String(e?.message || e) };
      }
    })();
  }
  return installPromise;
}

/**
 * Выполнить команду. Вывод приходит в onOutput (чанками), завершение — в onExit.
 * sessionId < 0 — команда не запустилась (error содержит причину).
 */
export function runCommand(cmd: string, cwd?: string): Promise<RuntimeHandle> {
  return rtExec(cmd, cwd);
}

export function killSession(sessionId: number): Promise<boolean> {
  return rtKill(sessionId);
}

export function subscribeOutput(l: OutputListener) {
  return onOutput((e) => l(e.sessionId, e.data));
}

export function subscribeExit(l: ExitListener) {
  return onExit((e) => l(e.sessionId, e.code));
}

/* ── CMD-блоки в ответах агента ─────────────────────────── */

export function parseCmdBlocks(text: string): string[] {
  const re = /\[CMD:\s*([^\n\]]+)\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

/** Убрать [CMD:…] блоки из текста (оставить только резюме). */
export function stripCmdBlocks(text: string): string {
  return text.replace(/\[CMD:\s*[^\n\]]+\]\s*/g, "").trim();
}

export type CmdResult = { ok: boolean; output: string; code: number; error?: string };

/**
 * Выполнить команду и дождаться завершения, собрав весь вывод.
 * Используется агентом для [CMD: …] блоков. Нативный execCapture делает всё
 * одним вызовом (запуск + сбор + ожидание) — без событий, поэтому нет гонки,
 * когда быстрая команда завершалась до подписки на onExit и JS висел вечно.
 * Если вывод длинный — кладём в файл проекта и возвращаем путь (не засоряем чат).
 */
export function runCommandCapture(cmd: string, projectId?: string, cwd?: string): Promise<CmdResult> {
  return new Promise(async (resolve) => {
    if (!runtimeAvailable()) {
      resolve({ ok: false, output: "", code: -1, error: "Рантайм доступен только на Android" });
      return;
    }
    // Гарантируем, что bootstrap установлен, ДО первой команды.
    const rt = await ensureRuntime();
    if (!rt.ok) {
      resolve({ ok: false, output: "", code: -1, error: `рантайм не готов: ${rt.message}` });
      return;
    }
    try {
      const r = await rtExecCapture(cmd, cwd);
      if (!r.ok) {
        // Реальная диагностика вместо догадки «SELinux». В toybox-режиме команды
        // идут через системный /system/bin/sh, поэтому любой сбой тула выглядит
        // как «исполнение недоступно» — но ПРИЧИНА может быть другая (не тот
        // интерпретатор, битый bootstrap, не хватает .so). Возвращаем модели
        // факт + команды для проверки, а НЕ готовый вердикт «система блокирует».
        let error = r.error || `exit ${r.code}`;
        if (r.code === 126 || r.code === 127 || r.code === -1) {
          error =
            `${error} (среда: ${runtimeMode()}). ` +
            `Продиагностируй причину: uname -m; ls $PREFIX/bin | head; echo $PREFIX $LD_LIBRARY_PATH; ` +
            `bincheck <бинарник> — и сообщи фактическую ошибку, а не «система блокирует».`;
        }
        resolve({ ok: false, output: r.output || "", code: r.code, error });
        return;
      }
      const text = r.output || "";
      // длинный вывод → в файл проекта
      if (projectId && text.length > 2000) {
        try {
          const name = `.aso/cmd-${Date.now()}.txt`;
          await writeFile(projectId, name, text);
          resolve({ ok: true, output: `вывод сохранён в ${name} (${text.length} симв.)`, code: 0 });
          return;
        } catch {}
      }
      resolve({ ok: true, output: text.slice(0, 4000), code: r.code });
    } catch (e: any) {
      resolve({ ok: false, output: "", code: -1, error: String(e?.message || e) });
    }
  });
}