import { fetchHistory } from '../src/api';

afterEach(() => jest.restoreAllMocks());

function barsResponse(bars: unknown[]) {
  return {
    ok: true,
    json: async () => ({ symbol: 'AAPL', timeframe: '1D', bars }),
  } as unknown as Response;
}

test('maps app frequency to the MarketStore timeframe and over-fetches warmup', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse([]));
  await fetchHistory('AAPL', '5min', 100);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('/v1/bars/AAPL');
  expect(url).toContain('timeframe=5Min');
  expect(url).toContain('limit=300'); // 100 + 200 warmup
});

test('returns empty columnar response when there are no bars', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse([]));
  const res = await fetchHistory('AAPL', 'D', 100);
  expect(res).toEqual({ columns: [], index: [], data: [] });
});

test('builds columnar HistoryResponse with ms index and indicator columns', async () => {
  const bars = [
    {
      time: '2024-01-12T00:00:00Z',
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 1000,
    },
    {
      time: '2024-01-15T00:00:00Z',
      open: 1.5,
      high: 2.5,
      low: 1,
      close: 2,
      volume: 1200,
    },
  ];
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse(bars));
  const res = await fetchHistory('AAPL', 'D', 2);

  expect(res.columns).toEqual([
    'open',
    'high',
    'low',
    'close',
    'volume',
    'sma20',
    'sma100',
    'sma200',
    'bbands_upper',
    'bbands_lower',
    'macd',
    'macd_signal',
    'macd_difference',
    'rsi',
  ]);
  // index is epoch milliseconds (ChartScreen divides by 1000).
  expect(res.index).toEqual([
    Date.parse('2024-01-12T00:00:00Z'),
    Date.parse('2024-01-15T00:00:00Z'),
  ]);
  // First five values of each row are raw OHLCV.
  expect(res.data[0].slice(0, 5)).toEqual([1, 2, 0.5, 1.5, 1000]);
  expect(res.data[1].slice(0, 5)).toEqual([1.5, 2.5, 1, 2, 1200]);
  // Indicators are null this early in the warmup (period not filled).
  expect(res.data[0][res.columns.indexOf('sma200')]).toBeNull();
});

test('slices off the warmup prefix so returned length is at most limit', async () => {
  const bars = Array.from({ length: 250 }, (_, i) => ({
    time: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(),
    open: i,
    high: i + 1,
    low: i - 1,
    close: i + 0.5,
    volume: 10,
  }));
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse(bars));
  const res = await fetchHistory('AAPL', 'D', 50);
  expect(res.index).toHaveLength(50);
  // sma200 is warm on the tail because indicators ran over the full 250 bars.
  expect(res.data[49][res.columns.indexOf('sma200')]).not.toBeNull();
});
