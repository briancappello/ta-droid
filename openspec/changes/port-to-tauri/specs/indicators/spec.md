## Purpose

Compute the chart indicators on the device so that they give the same results as fa-techan, which is the reference implementation.

## ADDED Requirements

### Requirement: Indicator columns and parameters
The app SHALL compute these columns, in this order: `sma20`, `sma100`, `sma200`, `bbands_upper`, `bbands_lower`, `macd`, `macd_signal`, `macd_difference`, `rsi`. The parameters SHALL be:
- SMA 100 and SMA 200;
- Bollinger Bands over 20 periods at ±2 population standard deviations, with the middle band reported as `sma20`;
- MACD 12/26/9, where `macd_difference` is `macd − macd_signal`;
- RSI 14 with Wilder smoothing.

#### Scenario: Column order
- **WHEN** indicators are computed
- **THEN** the columns appear in the stated order

### Requirement: Warmup values are null
A value SHALL be null until its indicator has enough input. For example, `sma100` SHALL be null for the first 99 bars and `sma200` for the first 199 bars.

#### Scenario: SMA warmup
- **WHEN** indicators are computed over 250 closes
- **THEN** `sma200` is null for indices 0 to 198 and set from index 199

### Requirement: Parity with fa-techan
On the reference fixture (`faTechanHistory.json`), every indicator column SHALL match fa-techan's values within a relative error of 1e-9 over the last 100 bars.

#### Scenario: Calibration fixture
- **WHEN** indicators are computed from the fixture's closes
- **THEN** every column in the last 100 bars is within 1e-9 relative error of the fixture's values
