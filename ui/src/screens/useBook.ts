import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountBook } from '../bindings/AccountBook';
import { bucketByAccount, filterByStrategies, firstError, strategiesPresent, tagAll } from '../book';
import type { StrategySelection } from '../components/StrategyFilter';
import { errorMessage } from '../ipc';

/** Load a per-account book on mount (screen focus) and on refresh. */
export function useBook<T>(load: () => Promise<AccountBook<T>[]>) {
  const [books, setBooks] = useState<AccountBook<T>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<StrategySelection>('all');

  const refresh = useCallback(async () => {
    try {
      const b = await load();
      setBooks(b);
      setError(firstError(b));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() sets state after IPC resolves.
    void refresh();
  }, [refresh]);

  const tagged = useMemo(() => tagAll(books), [books]);
  const options = useMemo(() => strategiesPresent(tagged), [tagged]);
  const buckets = useMemo(() => bucketByAccount(filterByStrategies(tagged, selection)), [tagged, selection]);
  return { buckets, options, selection, setSelection, error, refresh };
}
