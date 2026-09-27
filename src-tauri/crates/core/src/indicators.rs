//! Chart indicators through TA-Lib, with fa-techan's parameters
//! (indicators spec; fa-techan `app/api/v1/finance/history.py`).

/// Indicator columns, in the order the chart reads them.
pub const COLUMNS: [&str; 9] = [
    "sma20",
    "sma100",
    "sma200",
    "bbands_upper",
    "bbands_lower",
    "macd",
    "macd_signal",
    "macd_difference",
    "rsi",
];

/// One `Vec` per entry of [`COLUMNS`], each as long as the input.
pub type Columns = [Vec<Option<f64>>; 9];

/// Compute every indicator over `closes`. Warmup positions are `None`.
pub fn compute(closes: &[f64]) -> Columns {
    use talib_sys::{bbands, macd, rsi, sma};
    // The parameters are fixed and valid, so TA-Lib cannot reject them; an
    // input too short for a period just gives all-`None` output.
    let ok = |r: Result<Vec<Option<f64>>, talib_sys::TaError>| r.expect("fixed valid parameters");
    let [upper, middle, lower] = bbands(closes, 20, 2.0, 2.0).expect("fixed valid parameters");
    let [m, signal, hist] = macd(closes, 12, 26, 9).expect("fixed valid parameters");
    [
        middle,
        ok(sma(closes, 100)),
        ok(sma(closes, 200)),
        upper,
        lower,
        m,
        signal,
        hist,
        ok(rsi(closes, 14)),
    ]
}
