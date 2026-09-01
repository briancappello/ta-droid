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

const SECONDS_PER_DAY = 86400;
// 09:30 Eastern, in minutes past midnight.
const MARKET_OPEN_MINUTES = 9 * 60 + 30;

// Eastern calendar day bucket for a chart time (fake-UTC seconds representing
// Eastern time — see the TIMEZONE STRATEGY note in ChartScreen).
function easternDay(chartTime: number): number {
  return Math.floor(chartTime / SECONDS_PER_DAY);
}

// Returns one chart time per trading session: the first bar at or after the
// 09:30 open. Given an ascending series of chart times.
//
// The 5D axis labels each session at its market open. We cannot ask
// lightweight-charts for this — it only places ticks where the UTC date rolls
// over (i.e. the first bar of the day, which may be premarket 4:00 or 5:35),
// and it drops ticks it has no room for. So the labels are drawn as an overlay
// positioned with timeScale().timeToCoordinate(), and these are the anchors.
//
// A session with no bar at or after 09:30 (a symbol that only traded
// premarket) contributes no anchor, so it simply gets no label.
export function sessionOpenTimes(chartTimes: number[]): number[] {
  const opens: number[] = [];
  let lastDay: number | null = null;
  for (const time of chartTimes) {
    const day = easternDay(time);
    if (day === lastDay) {
      continue;
    }
    const d = new Date(time * 1000);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (minutes >= MARKET_OPEN_MINUTES) {
      opens.push(time);
      lastDay = day;
    }
  }
  return opens;
}

// A position on the chart's time axis. `src` indexes the source bar arrays, or
// is -1 for a padding slot that has no bar (drawn as whitespace).
export type ChartSlot = { time: number; src: number };

// Safety valve: never expand into an unbounded number of slots.
const MAX_SLOTS = 5000;

// Expands an ascending series of chart times into a uniform per-session grid,
// so every trading session occupies the SAME number of slots.
//
// lightweight-charts spaces bars by index, not by elapsed time. A symbol that
// barely trades produces few bars on a quiet session and many on an active one
// (FLYE: 4 bars one day, 78 the next), so the quiet sessions collapse into a
// few pixels and their labels overlap. Giving every session the same slot count
// makes each one the same width.
//
// The grid spans the earliest to the latest time-of-day seen anywhere in the
// series, so a symbol that never trades premarket does not get a wide empty
// margin every day.
//
// Any real bar that does not land on the grid is still emitted, so padding can
// never drop data.
export function padSessionGrid(
  chartTimes: number[],
  intervalSec: number,
): ChartSlot[] {
  const identity = (): ChartSlot[] =>
    chartTimes.map((time, src) => ({ time, src }));

  if (chartTimes.length === 0 || intervalSec <= 0) {
    return identity();
  }

  const offsetOf = (t: number) => ((t % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;

  let minOffset = Infinity;
  let maxOffset = -Infinity;
  const days: number[] = [];
  const srcByTime = new Map<number, number>();
  for (let i = 0; i < chartTimes.length; i++) {
    const time = chartTimes[i];
    const offset = offsetOf(time);
    if (offset < minOffset) {
      minOffset = offset;
    }
    if (offset > maxOffset) {
      maxOffset = offset;
    }
    const day = easternDay(time);
    if (days[days.length - 1] !== day) {
      days.push(day);
    }
    srcByTime.set(time, i);
  }

  const perSession = Math.floor((maxOffset - minOffset) / intervalSec) + 1;
  if (perSession * days.length > MAX_SLOTS) {
    return identity();
  }

  const times = new Set<number>();
  for (const day of days) {
    for (let k = 0; k < perSession; k++) {
      times.add(day * SECONDS_PER_DAY + minOffset + k * intervalSec);
    }
  }
  // Never lose a bar that sits off the grid.
  for (const time of chartTimes) {
    times.add(time);
  }

  return [...times]
    .sort((a, b) => a - b)
    .map(time => ({ time, src: srcByTime.get(time) ?? -1 }));
}

// Index of the first chart time belonging to the last `sessions` distinct
// Eastern days. Used to slice the 5D range to exactly 5 trading sessions
// rather than 7 calendar days, which would leave a partial sixth session.
export function sessionStartIndex(
  chartTimes: number[],
  sessions: number,
): number {
  const days: number[] = [];
  for (const time of chartTimes) {
    const day = easternDay(time);
    if (days[days.length - 1] !== day) {
      days.push(day);
    }
  }
  const firstDay = days[Math.max(0, days.length - sessions)];
  for (let i = 0; i < chartTimes.length; i++) {
    if (easternDay(chartTimes[i]) >= firstDay) {
      return i;
    }
  }
  return 0;
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
