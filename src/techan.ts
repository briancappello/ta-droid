// src/techan.ts
import { API_BASE } from './api';

export type StrategyPosition = {
  broker_id: string;
  account_id: string;
  symbol: string;
  strategy: string;
};

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      return fallback;
    }
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function fetchStrategyPositions(): Promise<StrategyPosition[]> {
  return getJson<StrategyPosition[]>('/strategies/positions', []);
}
