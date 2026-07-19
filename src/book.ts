// src/book.ts
import type { Account } from './alpaca';

export type Tagged<T> = { item: T; account: Account; strategy: string };
export type Bucket<T> = { account: Account; rows: Tagged<T>[] };
export type StrategyOf<T> = (item: T, account: Account) => string;

export function stubTagger<T>(): StrategyOf<T> {
  return () => 'Unattributed';
}

export function tagAll<T>(
  perAccount: { account: Account; items: T[] }[],
  strategyOf: StrategyOf<T>,
): Tagged<T>[] {
  const out: Tagged<T>[] = [];
  for (const { account, items } of perAccount) {
    for (const item of items) {
      const strategy = strategyOf(item, account) || 'Unattributed';
      out.push({ item, account, strategy });
    }
  }
  return out;
}

export function strategiesPresent<T>(tagged: Tagged<T>[]): string[] {
  const set = new Set(tagged.map(t => t.strategy));
  const hasUnattributed = set.delete('Unattributed');
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
  if (hasUnattributed) {
    sorted.push('Unattributed');
  }
  return sorted;
}

export function filterByStrategies<T>(
  tagged: Tagged<T>[],
  selected: string[] | 'all',
): Tagged<T>[] {
  if (selected === 'all') {
    return tagged;
  }
  const set = new Set(selected);
  return tagged.filter(t => set.has(t.strategy));
}

export function bucketByAccount<T>(tagged: Tagged<T>[]): Bucket<T>[] {
  const buckets: Bucket<T>[] = [];
  const byId = new Map<string, Bucket<T>>();
  for (const t of tagged) {
    let bucket = byId.get(t.account.id);
    if (!bucket) {
      bucket = { account: t.account, rows: [] };
      byId.set(t.account.id, bucket);
      buckets.push(bucket);
    }
    bucket.rows.push(t);
  }
  return buckets;
}
