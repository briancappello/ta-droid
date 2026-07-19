// src/strategyTagger.ts
import type { Account } from './alpaca';
import type { StrategyOf } from './book';
import { fetchStrategyPositions, type StrategyPosition } from './techan';

export function taggerFromMap(
  rows: StrategyPosition[],
): StrategyOf<{ symbol: string }> {
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.account_id}::${r.symbol}`, r.strategy);
  }
  return (item: { symbol: string }, account: Account) =>
    map.get(`${account.id}::${item.symbol}`) ?? 'Unattributed';
}

export async function loadTagger(): Promise<StrategyOf<{ symbol: string }>> {
  const rows = await fetchStrategyPositions();
  return taggerFromMap(rows);
}
