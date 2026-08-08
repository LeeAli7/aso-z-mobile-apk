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
  kill as rtKill,
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

/** Инициализировать рантайм при первом запуске (идемпотентно). */
export async function ensureRuntime(): Promise<{ ok: boolean; message: string }> {
  if (!runtimeAvailable()) {
    return { ok: false, message: "Встроенный рантайм доступен только на Android" };
  }
  try {
    if (await rtInstalled()) return { ok: true, message: "Рантайм установлен" };
    const prefix = await installBootstrap();
    return { ok: true, message: `Рантайм готов: ${prefix}` };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
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
 * Используется агентом для [CMD: …] блоков. Если вывод длинный — кладём
 * в файл проекта и возвращаем путь (не засоряем чат).
 */
export function runCommandCapture(cmd: string, projectId?: string, cwd?: string): Promise<CmdResult> {
  return new Promise(async (resolve) => {
    if (!runtimeAvailable()) {
      resolve({ ok: false, output: "", code: -1, error: "Рантайм доступен только на Android" });
      return;
    }
    const h = await runCommand(cmd, cwd);
    if (h.sessionId < 0) {
      resolve({ ok: false, output: "", code: -1, error: h.error || "не удалось запустить" });
      return;
    }
    const output: string[] = [];
    const unOut = subscribeOutput((id, data) => {
      if (id === h.sessionId) output.push(data);
    });
    const done = new Promise<void>((res) => {
      const unExit = subscribeExit((id, code) => {
        if (id === h.sessionId) {
          unExit.remove();
          res();
        }
      });
    });
    await done;
    unOut.remove();
    const text = output.join("");
    // длинный вывод → в файл проекта
    if (projectId && text.length > 2000) {
      try {
        const name = `.aso/cmd-${Date.now()}.txt`;
        await writeFile(projectId, name, text);
        return resolve({ ok: true, output: `вывод сохранён в ${name} (${text.length} симв.)`, code: 0 });
      } catch {}
    }
    resolve({ ok: true, output: text.slice(0, 4000), code: 0 });
  });
}