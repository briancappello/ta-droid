import { easternOffset, barFromBarPayload } from '../src/chartTime';

test('easternOffset is -4h in summer (EDT) and -5h in winter (EST)', () => {
  expect(easternOffset(Date.UTC(2026, 6, 15, 16, 0, 0))).toBe(-4 * 3600);
  expect(easternOffset(Date.UTC(2026, 0, 15, 16, 0, 0))).toBe(-5 * 3600);
});

test('barFromBarPayload maps OHLCV and shifts epoch by the eastern offset', () => {
  const epoch = Math.floor(Date.UTC(2026, 6, 15, 16, 0, 0) / 1000); // summer
  const bar = barFromBarPayload({
    epoch,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
  expect(bar).toEqual({
    time: epoch + -4 * 3600,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
});
