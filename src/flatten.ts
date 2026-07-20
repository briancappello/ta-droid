// src/flatten.ts
import { AlpacaError, type Account } from './alpaca';
import { driverFor, type Position, type NewOrderRequest } from './broker';

export type SymbolHolding = { account: Account; position: Position };
export type FlattenLeg = { account: Account; req: NewOrderRequest };
export type SubmitResult = { leg: FlattenLeg; ok: boolean; error?: string };

export async function holdingsForSymbol(
  accounts: Account[],
  symbol: string,
): Promise<SymbolHolding[]> {
  const settled = await Promise.allSettled(
    accounts.map(a => driverFor(a).listPositions(a)),
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
    legs.map(l => driverFor(l.account).createOrder(l.account, l.req)),
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

// Runs the "Exit all": submit the flatten legs and report per-leg + allOk.
export async function finishExit(
  legs: FlattenLeg[],
  submit: (l: FlattenLeg[]) => Promise<SubmitResult[]>,
): Promise<{ results: SubmitResult[]; allOk: boolean }> {
  const results = await submit(legs);
  const allOk = results.every(r => r.ok);
  return { results, allOk };
}
