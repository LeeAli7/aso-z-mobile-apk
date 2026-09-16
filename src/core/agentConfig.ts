/**
 * agentConfig.ts — конфиг агента (как Hermes config.yaml: agent/*, compression,
 * approvals, memory, delegation, curator).
 *
 * Всё в AsyncStorage, по умолчанию — как в Hermes. UI (Настройки → Агент)
 * читает/пишет через loadAgentConfig/saveAgentConfig.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ApprovalsMode = "smart" | "manual" | "off";

export interface AgentConfig {
  /** Лимит ходов агента (Hermes: agent.max_turns = 90). */
  maxTurns: number;
  /** Режим подтверждений (Hermes: approvals.mode). */
  approvalsMode: ApprovalsMode;
  /** Таймаут подтверждения, сек (Hermes: approvals.timeout). */
  approvalsTimeoutSec: number;
  /** Сжатие контекста (Hermes: compression.enabled/threshold). */
  compressionEnabled: boolean;
  compressionThreshold: number;
  /** Память (Hermes: memory.memory_enabled/user_profile_enabled). */
  memoryEnabled: boolean;
  userProfileEnabled: boolean;
  /** Делегирование (Hermes: delegation.max_concurrent_children). */
  maxConcurrentChildren: number;
  /** Куратор навыков (Hermes: curator.enabled). */
  curatorEnabled: boolean;
}

const KEY = "aso_agent_config";

/** Legacy-ключи SettingsScreen (Фаза 1: единый стор читает их, пока UI на них пишет). */
const LEGACY_KEYS = {
  maxTurns: "aso_agent_max_turns",
  approvals: "aso_approvals_mode",
  compression: "aso_compression",
  memoryEnabled: "aso_memory_enabled",
  delegationMax: "aso_delegation_max",
} as const;

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxTurns: 90,
  approvalsMode: "smart",
  approvalsTimeoutSec: 120,
  compressionEnabled: true,
  compressionThreshold: 0.5,
  memoryEnabled: true,
  userProfileEnabled: true,
  maxConcurrentChildren: 2,
  curatorEnabled: true,
};

export async function loadAgentConfig(): Promise<AgentConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const base = { ...DEFAULT_AGENT_CONFIG };
    if (raw) {
      try {
        Object.assign(base, JSON.parse(raw));
      } catch {}
    } else {
      // Фаза 1: JSON-конфига нет — подхватываем legacy-ключи UI (SettingsScreen пишет в них).
      try {
        const [mt, ap, co, me, dm] = await Promise.all([
          AsyncStorage.getItem(LEGACY_KEYS.maxTurns),
          AsyncStorage.getItem(LEGACY_KEYS.approvals),
          AsyncStorage.getItem(LEGACY_KEYS.compression),
          AsyncStorage.getItem(LEGACY_KEYS.memoryEnabled),
          AsyncStorage.getItem(LEGACY_KEYS.delegationMax),
        ]);
        if (mt !== null && !Number.isNaN(parseInt(mt, 10))) base.maxTurns = parseInt(mt, 10);
        if (ap === "smart" || ap === "manual" || ap === "off") base.approvalsMode = ap;
        if (co !== null) base.compressionEnabled = co !== "0";
        if (me !== null) base.memoryEnabled = me !== "0";
        if (dm !== null && !Number.isNaN(parseInt(dm, 10))) base.maxConcurrentChildren = parseInt(dm, 10);
      } catch {}
    }
    return base;
  } catch {
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

export async function saveAgentConfig(patch: Partial<AgentConfig>): Promise<AgentConfig> {
  const cur = await loadAgentConfig();
  const next: AgentConfig = { ...cur, ...patch };
  // clamp
  if (next.maxTurns < 1) next.maxTurns = 1;
  if (next.maxTurns > 500) next.maxTurns = 500;
  if (next.maxConcurrentChildren < 1) next.maxConcurrentChildren = 1;
  if (next.maxConcurrentChildren > 6) next.maxConcurrentChildren = 6;
  if (next.compressionThreshold < 0.1) next.compressionThreshold = 0.1;
  if (next.compressionThreshold > 0.95) next.compressionThreshold = 0.95;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  // Фаза 1: зеркалим в legacy-ключи — UI, читающий их напрямую, видит то же.
  try {
    await Promise.all([
      AsyncStorage.setItem(LEGACY_KEYS.maxTurns, String(next.maxTurns)),
      AsyncStorage.setItem(LEGACY_KEYS.approvals, next.approvalsMode),
      AsyncStorage.setItem(LEGACY_KEYS.compression, next.compressionEnabled ? "1" : "0"),
      AsyncStorage.setItem(LEGACY_KEYS.memoryEnabled, next.memoryEnabled ? "1" : "0"),
      AsyncStorage.setItem(LEGACY_KEYS.delegationMax, String(next.maxConcurrentChildren)),
    ]);
  } catch {}
  return next;
}
