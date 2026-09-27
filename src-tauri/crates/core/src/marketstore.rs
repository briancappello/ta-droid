//! MarketStore REST client (market-data spec): bars with indicators, quotes,
//! and watchlists, on the active profile.

use serde::{Deserialize, Serialize};

use crate::indicators;
use crate::profiles::Backend;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MarketDataError {
    #[error("Unknown frequency: {0}")]
    UnknownFrequency(String),
    #[error("Can't reach market data — check your connection.")]
    Unreachable,
    /// The server's `error` text, or "Market data error: <status>".
    #[error("{0}")]
    Server(String),
}

/// App frequency -> MarketStore timeframe.
pub fn freq_to_timeframe(freq: &str) -> Result<&'static str, MarketDataError> {
    Ok(match freq {
        "1min" => "1Min",
        "2min" => "2Min",
        "5min" => "5Min",
        "10min" => "10Min",
        "15min" => "15Min",
        "30min" => "30Min",
        "h" => "1H",
        "D" => "1D",
        "W" => "1W",
        "M" => "1M",
        other => return Err(MarketDataError::UnknownFrequency(other.to_owned())),
    })
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Bar {
    pub time: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Bars {
    pub symbol: String,
    pub timeframe: String,
    pub bars: Vec<Bar>,
}

#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Quote {
    #[serde(rename(serialize = "ticker"), alias = "ticker")]
    pub symbol: String,
    #[serde(rename(serialize = "date"), alias = "date")]
    pub time: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub prev_close: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct WatchlistEntry {
    pub symbol: String,
    #[serde(default)]
    pub rank: Option<f64>,
    #[serde(default)]
    pub sector: Option<String>,
    #[serde(default)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Watchlist {
    pub name: String,
    #[serde(default)]
    pub entries: Vec<WatchlistEntry>,
}

#[derive(Deserialize)]
struct Watchlists {
    watchlists: Vec<Watchlist>,
}

#[derive(Deserialize)]
struct Quotes {
    quotes: Vec<Quote>,
}

async fn get<T: serde::de::DeserializeOwned>(
    b: &Backend,
    path: &str,
    query: &[(&str, &str)],
) -> Result<T, MarketDataError> {
    let res = b
        .client()
        .get(b.marketstore_url(path))
        .query(query)
        .send()
        .await
        .map_err(|_| MarketDataError::Unreachable)?;
    let status = res.status();
    if !status.is_success() {
        #[derive(Deserialize)]
        struct ErrBody {
            error: String,
        }
        let msg = match res.json::<ErrBody>().await {
            Ok(body) => body.error,
            Err(_) => format!("Market data error: {}", status.as_u16()),
        };
        return Err(MarketDataError::Server(msg));
    }
    // A 2xx with a body that does not parse is a server fault too.
    res.json::<T>()
        .await
        .map_err(|_| MarketDataError::Server(format!("Market data error: {}", status.as_u16())))
}

fn encode_segment(s: &str) -> String {
    // Path segment encoding like `encodeURIComponent`.
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub async fn bars(
    b: &Backend,
    symbol: &str,
    timeframe: &str,
    limit: usize,
) -> Result<Bars, MarketDataError> {
    let limit = limit.to_string();
    get(
        b,
        &format!("/v1/bars/{}", encode_segment(symbol)),
        &[("timeframe", timeframe), ("limit", &limit)],
    )
    .await
}

/// Quotes for `symbols`. An empty list makes no request.
pub async fn quotes(b: &Backend, symbols: &[String]) -> Result<Vec<Quote>, MarketDataError> {
    if symbols.is_empty() {
        return Ok(Vec::new());
    }
    let joined = symbols.join(",");
    let q: Quotes = get(
        b,
        "/v1/quotes",
        &[("symbols", &joined), ("timeframe", "1D")],
    )
    .await?;
    Ok(q.quotes)
}

pub async fn watchlists(b: &Backend) -> Result<Vec<Watchlist>, MarketDataError> {
    Ok(get::<Watchlists>(b, "/v1/watchlists", &[])
        .await?
        .watchlists)
}

pub async fn watchlist(b: &Backend, name: &str) -> Result<Watchlist, MarketDataError> {
    get(b, &format!("/v1/watchlists/{}", encode_segment(name)), &[]).await
}

/// Extra bars fetched so the longest indicator (sma200) is warm across the
/// returned window, as fa-techan computes over the full series first.
pub const HISTORY_WARMUP: usize = 200;
pub const DEFAULT_HISTORY_LIMIT: usize = 1500;
pub const OHLCV_COLUMNS: [&str; 5] = ["open", "high", "low", "close", "volume"];

/// Columnar history: OHLCV then the indicator columns; `index` is epoch ms.
/// OHLCV cells are always set; indicator cells are `None` during warmup.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct History {
    pub columns: Vec<String>,
    #[ts(type = "Array<number>")]
    pub index: Vec<i64>,
    pub data: Vec<Vec<Option<f64>>>,
}

fn epoch_ms(time: &str) -> Result<i64, MarketDataError> {
    chrono::DateTime::parse_from_rfc3339(time)
        .map(|t| t.timestamp_millis())
        .map_err(|_| MarketDataError::Server(format!("Market data error: bad bar time {time}")))
}

pub async fn history(
    b: &Backend,
    symbol: &str,
    freq: &str,
    limit: Option<usize>,
) -> Result<History, MarketDataError> {
    let tf = freq_to_timeframe(freq)?;
    let want = limit.unwrap_or(DEFAULT_HISTORY_LIMIT);
    let Bars { bars, .. } = bars(b, symbol, tf, want + HISTORY_WARMUP).await?;
    build_history(&bars, want)
}

/// The pure part of [`history`].
pub fn build_history(bars: &[Bar], want: usize) -> Result<History, MarketDataError> {
    if bars.is_empty() {
        return Ok(History::default());
    }
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let ind = indicators::compute(&closes);
    let start = bars.len().saturating_sub(want);
    let mut out = History {
        columns: OHLCV_COLUMNS
            .iter()
            .chain(indicators::COLUMNS.iter())
            .map(|s| s.to_string())
            .collect(),
        ..History::default()
    };
    for (i, bar) in bars.iter().enumerate().skip(start) {
        out.index.push(epoch_ms(&bar.time)?);
        let mut row = vec![
            Some(bar.open),
            Some(bar.high),
            Some(bar.low),
            Some(bar.close),
            Some(bar.volume),
        ];
        row.extend(ind.iter().map(|c| c[i]));
        out.data.push(row);
    }
    Ok(out)
}
