// Strategy grouping and filtering for Positions and Orders (trading spec:
// strategy tags and filter). Tags come from the backend; this is view state.
import type { AccountBook } from './bindings/AccountBook';
import type { AccountView } from './bindings/AccountView';

export const UNATTRIBUTED = 'Unattributed';

export type TaggedRow<T> = { item: T; account: AccountView; strategy: string };
export type Bucket<T> = { account: AccountView; rows: TaggedRow<T>[] };

/** Flatten per-account books into tagged rows, in account order. */
export function tagAll<T>(books: AccountBook<T>[]): TaggedRow<T>[] {
  return books.flatMap(b => b.rows.map(r => ({ item: r.item, account: b.account, strategy: r.strategy || UNATTRIBUTED })));
}

/** Distinct strategies, sorted, with Unattributed last. */
export function strategiesPresent<T>(tagged: TaggedRow<T>[]): string[] {
  const set = new Set(tagged.map(t => t.strategy));
  const hasUnattributed = set.delete(UNATTRIBUTED);
  const sorted = [...set].sort((a, b) => a.localeCompare(b));
  if (hasUnattributed) sorted.push(UNATTRIBUTED);
  return sorted;
}

export function filterByStrategies<T>(tagged: TaggedRow<T>[], selected: string[] | 'all'): TaggedRow<T>[] {
  if (selected === 'all') return tagged;
  const set = new Set(selected);
  return tagged.filter(t => set.has(t.strategy));
}

/** Group rows by account, keeping the first-seen account order. */
export function bucketByAccount<T>(tagged: TaggedRow<T>[]): Bucket<T>[] {
  const buckets: Bucket<T>[] = [];
  const byId = new Map<string, Bucket<T>>();
  for (const t of tagged) {
    let b = byId.get(t.account.id);
    if (!b) {
      b = { account: t.account, rows: [] };
      byId.set(t.account.id, b);
      buckets.push(b);
    }
    b.rows.push(t);
  }
  return buckets;
}

/** The first account error, for the banner. */
export function firstError<T>(books: AccountBook<T>[]): string | null {
  return books.find(b => b.error != null)?.error ?? null;
}

/** `$1,234.00` / `-$5.10`; non-numbers pass through. */
export function usd(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-$' : '$'}${abs}`;
}
