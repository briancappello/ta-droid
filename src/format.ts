// Dollar amounts show 2 decimals, or 4 when the reference price is sub-$1
// (sub-dollar tickers trade in finer increments). `refPrice` decides the
// precision so a change is formatted to match its instrument's price, not its
// own magnitude; it defaults to the value itself.
export function formatMoney(value: number, refPrice: number = value): string {
  const decimals = Math.abs(refPrice) < 1 ? 4 : 2;
  return value.toFixed(decimals);
}

export function formatPercent(value: number): string {
  return value.toFixed(2);
}
