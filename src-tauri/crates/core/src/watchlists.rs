//! Watchlist presentation rules (market-data spec).

use serde::Serialize;
use serde_json::Value;

use crate::marketstore::{self, MarketDataError};
use crate::profiles::Backend;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WatchlistRef {
    /// The MarketStore name, used for requests and the stream key.
    pub id: String,
    /// Friendly label, or the raw name.
    pub name: String,
}

/// MarketStore watchlist names -> friendly labels.
pub fn label(name: &str) -> &str {
    match name {
        "PCT_CHANGE_UP" => "Top Gainers",
        "PCT_CHANGE_DOWN" => "Top Losers",
        "MOMENTUM" => "Momentum",
        "RELATIVE_VOLUME" => "Relative Volume",
        "GAP_UP" => "Gap Up",
        "GAP_DOWN" => "Gap Down",
        "SMA_CROSS_UP" => "SMA Cross Up",
        "SMA_CROSS_DOWN" => "SMA Cross Down",
        "INDUSTRY_AGGREGATE" => "Industry Aggregate",
        "SECTOR_AGGREGATE" => "Sector Aggregate",
        other => other,
    }
}

/// One display row.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WatchRow {
    pub symbol: String,
    /// Last price.
    pub price: Option<f64>,
    /// Price vs prior close (colors the price).
    pub price_up: Option<bool>,
    /// Intraday percent change from today's open.
    pub change_pct: Option<f64>,
    /// Change vs open (colors the change).
    pub change_up: Option<bool>,
    /// Aggregate rows: `avg_pct_change` instead of price and change.
    pub agg_pct: Option<f64>,
}

fn num(obj: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    obj.get(key).and_then(Value::as_f64)
}

/// Map a flattened ranked-symbol object (a WS `watchlist_update` symbol, or a
/// REST entry with its `fields` merged in) to a row.
pub fn to_row(obj: &serde_json::Map<String, Value>) -> WatchRow {
    let price = num(obj, "price");
    let prior = num(obj, "prior_close");
    let open = num(obj, "open");
    let change_pct = match (price, open) {
        (Some(p), Some(o)) if o != 0.0 => Some((p - o) / o * 100.0),
        _ => None,
    };
    WatchRow {
        symbol: obj
            .get("symbol")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        price,
        price_up: price.zip(prior).map(|(p, q)| p >= q),
        change_pct,
        change_up: change_pct.map(|c| c >= 0.0),
        agg_pct: num(obj, "avg_pct_change"),
    }
}

/// The live stream key for a watchlist.
pub fn stream_key(id: &str) -> String {
    format!("WATCHLISTS/1Min/{id}")
}

pub async fn list(b: &Backend) -> Result<Vec<WatchlistRef>, MarketDataError> {
    Ok(marketstore::watchlists(b)
        .await?
        .into_iter()
        .map(|w| WatchlistRef {
            name: label(&w.name).to_owned(),
            id: w.name,
        })
        .collect())
}

/// Initial REST paint of one watchlist.
pub async fn entries(b: &Backend, id: &str) -> Result<Vec<WatchRow>, MarketDataError> {
    Ok(marketstore::watchlist(b, id)
        .await?
        .entries
        .into_iter()
        .map(|e| {
            let mut obj = e.fields;
            obj.insert("symbol".into(), Value::String(e.symbol));
            to_row(&obj)
        })
        .collect())
}
