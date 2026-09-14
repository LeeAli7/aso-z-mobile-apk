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
    if (!raw) return { ...DEFAULT_AGENT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AGENT_CONFIG, ...parsed };
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
  return next;
}
