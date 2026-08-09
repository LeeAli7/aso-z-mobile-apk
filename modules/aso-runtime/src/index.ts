// AsoRuntime — JS-мост к встроенному Linux-рантайму.
// Нативный модуль AsoRuntime (Android, Kotlin): см. android/…/AsoRuntimeModule.kt

import { requireOptionalNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

// ── Типы ──────────────────────────────────────────────────────────────────

export interface ExecResult {
  sessionId: number;
  pid: number;
  error?: string;
}

export interface OutputEvent {
  sessionId: number;
  data: string;
}

export interface ExitEvent {
  sessionId: number;
  code: number;
}

export interface AsoRuntimeNative {
  isInstalled(): Promise<boolean>;
  install(): Promise<{ ok: boolean; prefix?: string; error?: string }>;
  exec(cmd: string, cwd?: string): Promise<ExecResult>;
  kill(sessionId: number): Promise<boolean>;
  execCapture(cmd: string, cwd?: string): Promise<{ ok: boolean; output: string; code: number; error?: string }>;
}

type AsoRuntimeEvents = {
  onOutput: (e: OutputEvent) => void;
  onExit: (e: ExitEvent) => void;
};

/** SDK 52+: requireNativeModule возвращает объект-EventEmitter — addListener типизируется картой событий.
 *  requireOptionalNativeModule: на web/платформах без нативного модуля возвращает null вместо throw —
 *  иначе импорт роняет всё приложение (белый экран). isAvailable() проверяет наличие. */
const native = requireOptionalNativeModule<AsoRuntimeNative>("AsoRuntime") as (AsoRuntimeNative & {
  addListener: <K extends keyof AsoRuntimeEvents>(name: K, l: AsoRuntimeEvents[K]) => EventSubscription;
}) | null;

/** Рантайм доступен только на Android (bootstrap физически в APK). */
export function isAvailable(): boolean {
  try {
    return !!native;
  } catch {
    return false;
  }
}

/** На web/не-Android модуля нет — бросаем понятную ошибку вместо TS-падения и белого экрана. */
function requireNative(): NonNullable<typeof native> {
  if (!native) throw new Error("AsoRuntime недоступен: нативный модуль есть только в Android-сборке");
  return native;
}

export function isInstalled(): Promise<boolean> {
  return requireNative().isInstalled();
}

export async function installBootstrap(): Promise<string> {
  const r = await requireNative().install();
  if (!r.ok) throw new Error(r.error || "bootstrap install failed");
  return r.prefix ?? "";
}

export function exec(cmd: string, cwd?: string): Promise<ExecResult> {
  return requireNative().exec(cmd, cwd);
}

export function kill(sessionId: number): Promise<boolean> {
  return requireNative().kill(sessionId);
}

/** Команда одним вызовом: вывод + код завершения. Без событий (нет гонки onExit). */
export function execCapture(cmd: string, cwd?: string): Promise<{ ok: boolean; output: string; code: number; error?: string }> {
  return requireNative().execCapture(cmd, cwd);
}

export function onOutput(listener: (e: OutputEvent) => void): EventSubscription {
  return requireNative().addListener("onOutput", listener);
}

export function onExit(listener: (e: ExitEvent) => void): EventSubscription {
  return requireNative().addListener("onExit", listener);
}