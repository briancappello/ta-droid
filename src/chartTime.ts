// One shared formatter — constructing Intl.DateTimeFormat is expensive, and
// buildEasternOffsets calls easternOffset O(log n) times per render. Hoisted
// to module scope so we build it once, mirroring the closure the old inline
// getOffset used.
const easternFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  timeZoneName: 'shortOffset',
});

// Eastern-time offset (seconds) for a given instant, matching the chart's
// "fake-UTC shifted to Eastern" time axis. Mirrors the getOffset logic in
// ChartScreen.buildEasternOffsets so live bars align with historical bars.
export function easternOffset(ms: number): number {
  const part = easternFmt
    .formatToParts(new Date(ms))
    .find(p => p.type === 'timeZoneName');
  const match = part?.value?.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1], 10) * 3600 : -5 * 3600;
}

// Maps a MarketStore `bar` payload {symbol,open,high,low,close,volume,epoch}
// (epoch in unix seconds) to a lightweight-charts point in the chart's
// eastern-shifted-seconds convention.
export function barFromBarPayload(p: any): {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} {
  return {
    time: p.epoch + easternOffset(p.epoch * 1000),
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
  };
}
