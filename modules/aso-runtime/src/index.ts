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

export function isInstalled(): Promise<boolean> {
  return native.isInstalled();
}

export async function installBootstrap(): Promise<string> {
  const r = await native.install();
  if (!r.ok) throw new Error(r.error || "bootstrap install failed");
  return r.prefix ?? "";
}

export function exec(cmd: string, cwd?: string): Promise<ExecResult> {
  return native.exec(cmd, cwd);
}

export function kill(sessionId: number): Promise<boolean> {
  return native.kill(sessionId);
}

export function onOutput(listener: (e: OutputEvent) => void): EventSubscription {
  return native.addListener("onOutput", listener);
}

export function onExit(listener: (e: ExitEvent) => void): EventSubscription {
  return native.addListener("onExit", listener);
}