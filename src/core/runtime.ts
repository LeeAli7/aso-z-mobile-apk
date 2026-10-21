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
 * Регистрирует долгую сессию в background.ts (шторка фоновых, стоп из UI).
 */
export function runCommand(cmd: string, cwd?: string): Promise<RuntimeHandle> {
  return (async () => {
    const h = await rtExec(cmd, cwd);
    if (h && h.sessionId >= 0) {
      try {
        const { registerBg, unregisterBg } = await import("./background");
        const sid = h.sessionId;
        registerBg("runtime", `runtime:${sid}`, `Команда: ${cmd.slice(0, 60)}`, async () => {
          try {
            await rtKill(sid);
          } catch {}
          unregisterBg(`runtime:${sid}`);
        }, sid);
        // автоснятие при выходе сессии (подписку снимаем, чтобы не копить слушатели)
        try {
          const sub = onExit((e) => {
            if (e.sessionId === sid) {
              unregisterBg(`runtime:${sid}`);
              try {
                sub?.remove();
              } catch {}
            }
          });
        } catch {}
      } catch {}
    }
    return h;
  })();
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

export type CmdResult = { ok: boolean; output: string; code: number; error?: string; timedOut?: boolean };

/**
 * Выполнить команду и дождаться завершения, собрав весь вывод.
 * Используется агентом для [CMD: …] блоков. Нативный execCapture делает всё
 * одним вызовом (запуск + сбор + ожидание) — без событий, поэтому нет гонки,
 * когда быстрая команда завершалась до подписки на onExit и JS висел вечно.
 * Если вывод длинный — кладём в файл проекта и возвращаем путь (не засоряем чат).
 */
export function runCommandCapture(
  cmd: string,
  projectId?: string,
  cwd?: string,
  limit = 4000,
  timeoutMs = 120_000,
): Promise<CmdResult> {
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
      // Тайм-аут ОБЯЗАТЕЛЕН: без него долгий процесс (дев-сервер, холст,
      // watch-режим) держал promise вечно, чат висел в ожидании и потом падал
      // по сетевому таймауту, хотя сам сервер уже поднялся.
      // Дублируем защиту на стороне JS: даже если нативный код не ответит
      // (старая сборка модуля), промис разрешится по тайм-ауту.
      const r: any = await Promise.race([
        rtExecCapture(cmd, cwd, timeoutMs),
        new Promise((res) =>
          setTimeout(
            () =>
              res({
                ok: false,
                output: "",
                code: -2,
                timedOut: true,
                error: `нет ответа за ${Math.round((timeoutMs + 15_000) / 1000)} с — процесс не завершился`,
              }),
            timeoutMs + 15_000,
          ),
        ),
      ]);
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
        resolve({ ok: false, output: r.output || "", code: r.code, error, timedOut: !!r.timedOut });
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
      // Обрезка больше не молчит: иначе в терминале терялся хвост логов
      // (пользователь и модель думают, что это весь вывод).
      const LIMIT = Math.max(1000, limit);
      if (text.length > LIMIT) {
        const kept = text.slice(0, LIMIT);
        resolve({
          ok: true,
          output: `${kept}\n… обрезано: показано ${LIMIT} из ${text.length} симв.`,
          code: r.code,
        });
        return;
      }
      resolve({ ok: true, output: text, code: r.code });
    } catch (e: any) {
      resolve({ ok: false, output: "", code: -1, error: String(e?.message || e) });
    }
  });
}


/**
 * Похоже ли на долгоживущий процесс (сервер/демон/watch)?
 * Такие команды НЕЛЬЗЯ ждать до завершения — они не завершаются никогда:
 * нужно запускать их в фоне и отдавать модель/пользователю pid + первые строки.
 */
export function isLongRunningCommand(cmd: string): boolean {
  const c = (cmd || "").toLowerCase();
  if (!c.trim()) return false;
  if (/(^|\s)--watch(\s|$)|(^|\s)watch\s|nodemon|pm2\s+(start|dev)/.test(c)) return true;
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b/.test(c)) return true;
  if (/\b(vite|next\s+dev|nuxt\s+dev|expo\s+start|react-scripts\s+start|ng\s+serve|webpack-dev-server|live-server|http-server|serve\s+-s)\b/.test(c)) return true;
  if (/python3?\s+-m\s+http\.server/.test(c)) return true;
  if (/\b(flask\s+run|uvicorn|gunicorn|fastapi\s+run|streamlit\s+run|jupyter\s+(notebook|lab))\b/.test(c)) return true;
  if (/\b(php\s+-S|rails\s+s|django-admin\s+runserver|docker\s+(run(?!\s+-{1,2}rm)|compose\s+up))\b/.test(c)) return true;
  // `node server.js`, `python app.py` — только если в конце нет `&` и нет явного одноразового действия
  if (/(^|[;&|]\s*)(node|python3?|ruby|java)\s+[^;&|]*\.(js|mjs|cjs|py|rb|jar)(\s|$)/.test(c)) return true;
  return false;
}

export type BgStartResult = {
  ok: boolean;
  sessionId: number;
  pid?: number;
  ready: boolean;
  output: string;
  error?: string;
};

/**
 * Запустить долгий процесс в фоне и подождать готовности (порт/«listening»).
 * Возвращается быстро: чат не висит, сервер продолжает работать, его вывод
 * виден в панели фоновых процессов и его можно остановить.
 */
export async function runCommandBackground(cmd: string, cwd?: string, waitMs = 12_000): Promise<BgStartResult> {
  if (!runtimeAvailable()) {
    return { ok: false, sessionId: -1, ready: false, output: "", error: "Рантайм доступен только на Android" };
  }
  const rt = await ensureRuntime();
  if (!rt.ok) {
    return { ok: false, sessionId: -1, ready: false, output: "", error: `рантайм не готов: ${rt.message}` };
  }
  let buf = "";
  let ready = false;
  let exitCode: number | null = null;
  let handle: RuntimeHandle;
  try {
    handle = await runCommand(cmd, cwd);
  } catch (e: any) {
    return { ok: false, sessionId: -1, ready: false, output: "", error: String(e?.message || e) };
  }
  if (!handle || handle.sessionId < 0) {
    return {
      ok: false,
      sessionId: handle?.sessionId ?? -1,
      ready: false,
      output: "",
      error: handle?.error || "не удалось запустить процесс",
    };
  }
  const sid = handle.sessionId;
  const READY_RE = /(listening|running on|started server|server running|local: http|127\.0\.0\.1|localhost|0\.0\.0\.0|preview|serving at|uvicorn running|compiled successfully|Serving HTTP|ready in)/i;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        try { unsub?.remove?.(); } catch {}
        try { unsubExit?.remove?.(); } catch {}
      } catch {}
      resolve();
    };
    const unsub = subscribeOutput((sessionId: number, data: string) => {
      if (sessionId !== sid) return;
      buf += data;
      if (buf.length > 8000) buf = buf.slice(-8000);
      if (READY_RE.test(buf)) {
        ready = true;
        finish();
      }
    });
    const unsubExit = subscribeExit((sessionId: number, code: number) => {
      if (sessionId !== sid) return;
      exitCode = code;
      finish();
    });
    setTimeout(finish, waitMs);
  });
  const clean = buf.trim().slice(-3000);
  if (exitCode !== null && exitCode !== 0) {
    return {
      ok: false,
      sessionId: sid,
      pid: handle.pid,
      ready: false,
      output: clean,
      error: `процесс завершился с кодом ${exitCode}`,
    };
  }
  return { ok: true, sessionId: sid, pid: handle.pid, ready, output: clean };
}

/**
 * Катастрофические команды: их блокируем ДО запуска.
 * Обычные `rm -rf node_modules`, `apt remove` и т.п. не трогаем — блокируем
 * только то, что стирает систему/домашний каталог целиком.
 */
export function checkDangerousCommand(cmd: string): string | null {
  const c = (cmd || "").trim();
  if (!c) return null;
  const rules: Array<{ re: RegExp; why: string }> = [
    { re: /rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+|--force\s+)*\/\s*($|[;&|])/, why: "удаление корня файловой системы" },
    { re: /rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(~|\$HOME|\/root|\/home)(\/\s*|\s*$|[;&|])/, why: "удаление домашнего каталога целиком" },
    { re: /\bmkfs(\.|\s)|mke2fs\b/, why: "форматирование раздела" },
    { re: /\bdd\b[^\n]*\bof=\/dev\/(block|mmcblk|sd|nvme)/, why: "запись на блочное устройство" },
    { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork-бомба" },
    { re: /\bchmod\s+-R\s+777\s+\/(\s|$)/, why: "снятие прав на весь корень" },
    { re: /\b(reboot|shutdown|halt|poweroff)\b/, why: "перезагрузка/выключение устройства" },
  ];
  for (const r of rules) {
    if (r.re.test(c)) return r.why;
  }
  return null;
}

