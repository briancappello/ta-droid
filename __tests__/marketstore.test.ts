import { getBars, getQuotes, freqToTimeframe } from '../src/marketstore';

afterEach(() => jest.restoreAllMocks());

test('freqToTimeframe maps app frequencies to MarketStore timeframes', () => {
  expect(freqToTimeframe('1min')).toBe('1Min');
  expect(freqToTimeframe('30min')).toBe('30Min');
  expect(freqToTimeframe('h')).toBe('1H');
  expect(freqToTimeframe('D')).toBe('1D');
  expect(freqToTimeframe('W')).toBe('1W');
});

test('freqToTimeframe throws on unknown frequency', () => {
  expect(() => freqToTimeframe('bogus')).toThrow(/Unknown frequency/);
});

test('getBars requests the bars endpoint with timeframe and limit', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ symbol: 'AAPL', timeframe: '1D', bars: [] }),
  } as unknown as Response);
  await getBars('AAPL', '1D', 50);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('https://ms.test/v1/bars/AAPL');
  expect(url).toContain('timeframe=1D');
  expect(url).toContain('limit=50');
});

test('getQuotes joins symbols and defaults timeframe to 1D', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ quotes: [] }),
  } as unknown as Response);
  await getQuotes(['AAPL', 'MSFT']);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('https://ms.test/v1/quotes');
  expect(url).toContain('symbols=AAPL%2CMSFT');
  expect(url).toContain('timeframe=1D');
});

test('non-2xx surfaces the server error message', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ error: 'symbol not found' }),
  } as unknown as Response);
  await expect(getBars('NOPE', '1D', 10)).rejects.toThrow('symbol not found');
});

test('network failure surfaces a friendly message', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
  await expect(getQuotes(['AAPL'])).rejects.toThrow(/Can't reach market data/);
});
