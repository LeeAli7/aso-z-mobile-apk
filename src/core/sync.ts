/**
 * Синхронизация аккаунта с Telegram по username.
 *
 * Никакой LLM-трафик здесь не ходит. Только разовый обмен при входе:
 * 1) юзер вводит @username → сервер шлёт боту запрос в личку;
 * 2) юзер в боте жмёт Принять → сервер выдаёт JWT;
 * 3) приложение забирает JWT и профиль (квоты, подписка, модели).
 */
import { config } from "./env";

const API = config.apiBase;

export async function requestSync(username: string, deviceId: string) {
  const resp = await fetch(`${API}/api/mobile/sync-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, device_id: deviceId }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.detail || `sync-request ${resp.status}`);
  return data;
}

export async function pollSync(deviceId: string): Promise<{
  status: string;
  token?: string;
  username?: string;
}> {
  const resp = await fetch(`${API}/api/mobile/sync-status?device_id=${deviceId}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.detail || `sync-status ${resp.status}`);
  return data;
}

export async function fetchProfile(token: string) {
  const resp = await fetch(`${API}/api/mobile/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.detail || `profile ${resp.status}`);
  return data;
}