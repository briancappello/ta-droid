// The chart screen (charting spec): header, ranges, held-symbol strip,
// three synced panes, and live bars.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { HoldingView } from '../bindings/HoldingView';
import { barFromBarPayload } from '../chart/chartTime';
import { ChartPanes, type ChartPanesHandle } from '../chart/ChartPanes';
import { DEFAULT_RANGE_INDEX, FREQ_MINUTES, getRequestBars, RANGES, sliceToWindow, TIMEFRAME, type FreqOption } from '../chart/ranges';
import { buildSeries, type ChartSeries } from '../chart/series';
import { Modal } from '../components/Modal';
import { useDrawer } from '../components/Shell';
import ui from '../components/ui.module.css';
import { formatMoney } from '../format';
import { api, errorMessage, live } from '../ipc';
import { DEFAULT_TICKER } from '../routes';
import { useAccounts } from '../state/accounts';
import styles from './ChartScreen.module.css';

function FreqDropdown({ options, selected, onSelect }: { options: FreqOption[]; selected: string; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = options.find(o => o.value === selected)?.label ?? selected;
  return (
    <>
      <button className={ui.pickerButton} onClick={() => setOpen(true)} data-testid="freq-picker">
        {label} ▼
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} testId="freq-menu">
          {options.map(o => (
            <button
              key={o.value}
              className={`${ui.menuItem} ${o.value === selected ? ui.menuItemActive : ''}`}
              data-testid={`freq-${o.value}`}
              onClick={() => {
                onSelect(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </Modal>
      )}
    </>
  );
}

export function ChartScreen() {
  const { ticker = DEFAULT_TICKER } = useParams();
  const navigate = useNavigate();
  const { openDrawer } = useDrawer();
  const { activeId } = useAccounts();
  const panes = useRef<ChartPanesHandle>(null);

  const [rangeIndex, setRangeIndex] = useState(DEFAULT_RANGE_INDEX);
  const [freq, setFreq] = useState(RANGES[DEFAULT_RANGE_INDEX].defaultFreq);
  const [series, setSeries] = useState<ChartSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  // The header symbol is the input: it shows the ticker; typing over it
  // switches the chart. Re-sync whenever the ticker changes from elsewhere.
  const [symInput, setSymInput] = useState(ticker);
  const [prevTicker, setPrevTicker] = useState(ticker);
  if (prevTicker !== ticker) {
    setPrevTicker(ticker);
    setSymInput(ticker);
  }

  const range = RANGES[rangeIndex];

  const submitSymbol = useCallback(() => {
    const next = symInput.trim().toUpperCase();
    if (next && next !== ticker) navigate(`/chart/${encodeURIComponent(next)}`, { replace: true });
    else setSymInput(ticker);
  }, [symInput, ticker, navigate]);

  useEffect(() => {
    let alive = true;
    api.symbolHoldings(ticker).then(
      h => alive && setHoldings(h),
      () => alive && setHoldings([]),
    );
    return () => {
      alive = false;
    };
  }, [ticker]);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before a new load.
    setLoading(true);
    setError(null);
    api
      .history(ticker, freq, getRequestBars(range, freq))
      .then(raw => {
        if (!alive) return;
        const data = sliceToWindow(raw, range.windowMs, range.sessions);
        if (data.data.length === 0) {
          setSeries(null);
          setError('No data available for this range');
          return;
        }
        const close = data.columns.indexOf('close');
        setLastPrice(close >= 0 ? (data.data[data.data.length - 1][close] ?? null) : null);
        setSeries(buildSeries(data, range.sessions ? (FREQ_MINUTES[freq] ?? 0) * 60 : 0));
      })
      .catch(e => alive && setError(errorMessage(e, 'Market data error.')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ticker, freq, range]);

  useEffect(() => {
    const tf = TIMEFRAME[freq];
    if (!tf) return;
    return live.bars(ticker, tf, b => {
      const bar = barFromBarPayload(b);
      setLastPrice(bar.close);
      panes.current?.pushBar(bar);
    });
  }, [ticker, freq]);

  const pills = useMemo(
    () =>
      RANGES.map((r, i) => (
        <button
          key={r.label}
          className={`${styles.pill} ${i === rangeIndex ? styles.pillActive : ''}`}
          aria-pressed={i === rangeIndex}
          data-testid={`range-${r.label}`}
          onClick={() => {
            setRangeIndex(i);
            setFreq(r.defaultFreq);
          }}
        >
          {r.label}
        </button>
      )),
    [rangeIndex],
  );

  return (
    <section style={{ display: 'contents' }} data-testid="screen-chart">
      <header className={styles.header}>
        <div className={styles.left}>
          <button className={styles.menu} onClick={openDrawer} aria-label="Open navigation menu" data-testid="menu">
            ☰
          </button>
          <input
            className={styles.symbol}
            aria-label="Switch symbol"
            data-testid="symbol-input"
            value={symInput}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onFocus={e => e.currentTarget.select()}
            onChange={e => setSymInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                submitSymbol();
                e.currentTarget.blur();
              }
            }}
            onBlur={() => setSymInput(ticker)}
          />
          {lastPrice != null && (
            <span className={styles.price} data-testid="last-price">
              {formatMoney(lastPrice)}
            </span>
          )}
        </div>
        <button
          className={styles.trade}
          aria-label="Trade"
          data-testid="trade"
          onClick={() => navigate('order', { state: { symbol: ticker, accountId: activeId } })}
        >
          Trade
        </button>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.pills}>{pills}</div>
        <FreqDropdown options={range.freqOptions} selected={freq} onSelect={setFreq} />
        {holdings.length > 0 && (
          <button className={styles.exit} onClick={() => navigate('exit')} data-testid="exit">
            Exit
          </button>
        )}
      </div>
      {holdings.length > 0 && (
        <div className={styles.strip} data-testid="positions-strip">
          {holdings.map(h => {
            const pl = Number(h.unrealized_pl);
            return (
              <span key={h.account_id} className={styles.posPill}>
                <span>
                  {h.account_name} · {h.qty} @ {h.avg_entry_price}
                </span>
                <span style={{ color: pl >= 0 ? '#4caf50' : '#f44336' }}>
                  {pl >= 0 ? '+' : ''}
                  {h.unrealized_pl}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {error ? (
        <div className={styles.center}>
          <p className={styles.error} data-testid="chart-error">
            {error}
          </p>
        </div>
      ) : loading ? (
        <div className={styles.center}>
          <div className={styles.spinner} role="progressbar" data-testid="chart-loading" />
        </div>
      ) : series ? (
        <ChartPanes ref={panes} series={series} range={range.label} />
      ) : null}
    </section>
  );
}
