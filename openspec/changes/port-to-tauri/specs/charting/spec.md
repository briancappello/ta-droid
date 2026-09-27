## Purpose

Show a symbol's price history with volume and indicators across fixed ranges. The chart updates from the live stream, and trading actions start from it.

## ADDED Requirements

### Requirement: Chart layout
The chart SHALL have three panes that share a time axis and stay aligned when scrolled or zoomed:
- **Main pane (about 55% of the height):** candles, volume in the bottom 20% colored by candle direction, SMA20, SMA100, SMA200, and dashed Bollinger bands.
- **MACD pane (about 22%):** the MACD line, the signal line, and a histogram colored by sign.
- **RSI pane (about 23%):** the RSI line.

The chart SHALL use a dark theme and work offline once data is loaded. A series with no values SHALL NOT be drawn. Warmup gaps SHALL NOT shift the panes out of alignment.

#### Scenario: Pane sync
- **WHEN** the user scrolls the main pane
- **THEN** the MACD and RSI panes show the same time range

### Requirement: Ranges and frequencies
The chart SHALL offer these ranges, each with its allowed frequencies and a default:

| Range | Frequencies | Default | Window |
|---|---|---|---|
| 1D | 1, 5, 10, 15 min | 1 min | 1 day |
| 5D | 5, 10, 15, 30 min; 1 hr | 5 min | last 5 sessions |
| 1M | 15, 30 min; 1 hr; 1 day | 1 hr | 30 days |
| 6M | 1 day; 1 week | 1 day | 182 days |
| 1Y | 1 day; 1 week | 1 day | 365 days |
| 5Y | 1 week; 1 month | 1 week | 5 years |

The chart SHALL open at 1Y with daily bars. Changing the range SHALL reset the frequency to that range's default. The number of bars requested SHALL cover the window, counting a daily bar as 16 hours. The displayed window SHALL end at the latest bar.

#### Scenario: Range change resets frequency
- **WHEN** the user switches from 1Y to 1D
- **THEN** the frequency becomes 1 min and the chart shows one day

### Requirement: Eastern market time
All bar times SHALL be displayed in America/New_York time, following daylight saving per bar. Tick labels SHALL be:
- hours for 1D, including "9:30";
- day names at the 09:30 open for 5D;
- "Mon D" for 1M, 6M, and 1Y;
- "Mon YYYY" for 5Y.

In 5D, every session SHALL occupy the same horizontal width, and no bar SHALL be dropped. A session without a 09:30 bar SHALL get no day label.

#### Scenario: DST boundary
- **WHEN** the displayed bars span the March daylight-saving change
- **THEN** bars before the change are shown at UTC−5 and bars after it at UTC−4

#### Scenario: 5D equal sessions
- **WHEN** one of the five sessions is a half day
- **THEN** it takes the same width as a full session and none of its bars are dropped

### Requirement: Chart header
The header SHALL have a drawer button, an editable symbol field, the last price, and a Trade button. Submitting the symbol field SHALL uppercase the input and load that symbol. Empty or unchanged input, or leaving the field, SHALL restore the current symbol. The last price SHALL be the latest close and SHALL follow live bars. Trade SHALL open order entry with the symbol and the active account. The default symbol SHALL be AMD.

#### Scenario: Symbol change
- **WHEN** the user types "msft" and submits
- **THEN** the chart loads MSFT

### Requirement: Held-symbol strip
When any account holds the symbol, the chart SHALL show an Exit button and one entry per holding account in the form `Name · qty @ avg` with the unrealized P/L colored by sign. When no account holds the symbol, neither SHALL be shown.

#### Scenario: Not held
- **WHEN** no account has a position in the symbol
- **THEN** no Exit button and no positions strip are shown

### Requirement: Loading and empty states
While data loads, the chart SHALL show a spinner. On a data error it SHALL show the error text. With no bars it SHALL show "No data available for this range".

#### Scenario: Empty range
- **WHEN** MarketStore returns no bars
- **THEN** "No data available for this range" is shown

### Requirement: Live bars
The chart SHALL subscribe to `{SYMBOL}/{timeframe}/OHLCV` for the current symbol and frequency, and resubscribe when either changes. Each message with `msg_type` `bar` SHALL update the latest candle and volume, or append new ones. Indicators SHALL NOT update live. A frequency that MarketStore does not stream SHALL stay static without error.

#### Scenario: New bar arrives
- **WHEN** a bar message arrives with a time after the last candle
- **THEN** a new candle and volume bar are appended and the last price updates
