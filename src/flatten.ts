// src/flatten.ts
import {
  AlpacaError,
  createOrder,
  listPositions,
  type Account,
  type AlpacaPosition,
  type NewOrderRequest,
} from './alpaca';

export type SymbolHolding = { account: Account; position: AlpacaPosition };
export type FlattenLeg = { account: Account; req: NewOrderRequest };
export type SubmitResult = { leg: FlattenLeg; ok: boolean; error?: string };

export async function holdingsForSymbol(
  accounts: Account[],
  symbol: string,
): Promise<SymbolHolding[]> {
  const settled = await Promise.allSettled(
    accounts.map(a => listPositions(a)),
  );
  const out: SymbolHolding[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const p = r.value.find(x => x.symbol === symbol);
      if (p) {
        out.push({ account: accounts[i], position: p });
      }
    }
  });
  return out;
}

export function flattenPlan(holdings: SymbolHolding[]): FlattenLeg[] {
  return holdings.map(({ account, position }) => ({
    account,
    req: {
      symbol: position.symbol,
      side: position.side === 'short' ? 'buy' : 'sell',
      type: 'market',
      time_in_force: 'day',
      qty: Math.abs(Number(position.qty)).toString(),
    },
  }));
}

export async function submitFlatten(
  legs: FlattenLeg[],
): Promise<SubmitResult[]> {
  const settled = await Promise.allSettled(
    legs.map(l => createOrder(l.account, l.req)),
  );
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { leg: legs[i], ok: true };
    }
    const e = r.reason;
    const error = e instanceof AlpacaError ? e.message : 'Failed to submit.';
    return { leg: legs[i], ok: false, error };
  });
}

// Orchestrates the "Exit all" outcome: flatten is authoritative, the
// suppress is best-effort. A throwing/failing suppress must never change the
// flatten result — this is the single seam ExitScreen calls and Task 19 wires
// the real postExitSuppress into.
export async function finishExit(
  legs: FlattenLeg[],
  symbol: string,
  submit: (l: FlattenLeg[]) => Promise<SubmitResult[]>,
  suppress: (s: string, ids: string[]) => Promise<boolean>,
): Promise<{ results: SubmitResult[]; allOk: boolean; suppressed: boolean }> {
  const results = await submit(legs);
  const allOk = results.every(r => r.ok);
  const ids = legs.map(l => l.account.id);
  let suppressed = false;
  try {
    suppressed = await suppress(symbol, ids);
  } catch {
    suppressed = false; // best-effort: swallow, flatten stands
  }
  return { results, allOk, suppressed };
}
