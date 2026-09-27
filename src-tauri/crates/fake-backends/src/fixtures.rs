//! Deterministic fixture data. Prices are a smooth function of time, so any
//! window of any timeframe is reproducible and indicators have real shape.
//!
//! The anchor is Friday 2026-09-25, 16:00 America/New_York (EDT, UTC−4):
//! the latest bar ends at the close of that session.

use serde_json::{Value, json};

/// An Alpaca test account. Keys match `config/app-config.e2e.toml` and the
/// provisioning fixtures; they are test values, not secrets.
#[derive(Debug, Clone, Copy)]
pub struct FakeAccount {
    pub id: &'static str,
    pub key: &'static str,
    pub secret: &'static str,
}

pub const ACCOUNTS: [FakeAccount; 2] = [
    FakeAccount {
        id: "PA1TEST",
        key: "PKTESTKEY0000001",
        secret: "test-secret-0001",
    },
    FakeAccount {
        id: "LV1TEST",
        key: "AKTESTKEY0000002",
        secret: "test-secret-0002",
    },
];

/// 2026-09-25T20:00:00Z.
const ANCHOR: i64 = 1_790_366_400;
const DAY: i64 = 86_400;
/// Session open in UTC seconds of day during EDT (09:30 ET).
const OPEN_UTC: i64 = 13 * 3600 + 30 * 60;
const CLOSE_UTC: i64 = 20 * 3600;

fn base_price(symbol: &str) -> f64 {
    let h = symbol
        .bytes()
        .fold(7u64, |h, b| h.wrapping_mul(31).wrapping_add(u64::from(b)));
    match symbol {
        "PENNY" => 0.4567,
        _ => 20.0 + (h % 480) as f64,
    }
}

/// Price at a unix time: slow and fast waves plus drift.
pub fn price_at(symbol: &str, t: i64) -> f64 {
    let x = t as f64;
    let base = base_price(symbol);
    let p = base
        * (1.0
            + 0.08 * (x / (DAY as f64 * 9.0)).sin()
            + 0.02 * (x / 5400.0).sin()
            + (x - ANCHOR as f64) / (DAY as f64 * 3650.0));
    (p * 10_000.0).round() / 10_000.0
}

fn is_weekday(t: i64) -> bool {
    // 1970-01-01 was a Thursday.
    let dow = (t.div_euclid(DAY) + 4).rem_euclid(7); // 0 = Sunday
    (1..=5).contains(&dow)
}

fn iso(t: i64) -> String {
    let days = t.div_euclid(DAY);
    let secs = t.rem_euclid(DAY);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        secs / 60 % 60,
        secs % 60
    )
}

/// Howard Hinnant's days-to-civil.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Bar start times, oldest first, ending at the anchor session.
fn starts(timeframe: &str, limit: usize) -> Option<Vec<(i64, i64)>> {
    let intraday = |mins: i64| {
        let step = mins * 60;
        let mut out = Vec::with_capacity(limit);
        let mut day = ANCHOR.div_euclid(DAY) * DAY;
        while out.len() < limit {
            if is_weekday(day) {
                let mut t = day + CLOSE_UTC - step;
                while t >= day + OPEN_UTC && out.len() < limit {
                    out.push((t, step));
                    t -= step;
                }
            }
            day -= DAY;
        }
        out
    };
    let mut v = match timeframe {
        "1Min" => intraday(1),
        "2Min" => intraday(2),
        "5Min" => intraday(5),
        "10Min" => intraday(10),
        "15Min" => intraday(15),
        "30Min" => intraday(30),
        "1H" => intraday(60),
        "1D" => {
            let mut out = Vec::with_capacity(limit);
            let mut day = ANCHOR.div_euclid(DAY) * DAY;
            while out.len() < limit {
                if is_weekday(day) {
                    out.push((day, DAY));
                }
                day -= DAY;
            }
            out
        }
        "1W" => {
            // Mondays at 00:00Z.
            let mut day = ANCHOR.div_euclid(DAY) * DAY;
            while (day.div_euclid(DAY) + 4).rem_euclid(7) != 1 {
                day -= DAY;
            }
            (0..limit as i64)
                .map(|i| (day - i * 7 * DAY, 7 * DAY))
                .collect()
        }
        "1M" => {
            let (mut y, mut m, _) = civil_from_days(ANCHOR.div_euclid(DAY));
            let mut out = Vec::with_capacity(limit);
            while out.len() < limit {
                out.push((days_from_civil(y, m, 1) * DAY, 30 * DAY));
                if m == 1 {
                    y -= 1;
                    m = 12;
                } else {
                    m -= 1;
                }
            }
            out
        }
        _ => return None,
    };
    v.reverse();
    Some(v)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `limit` bars of `symbol` for a MarketStore timeframe; None if unknown.
pub fn bars(symbol: &str, timeframe: &str, limit: usize) -> Option<Vec<Value>> {
    let limit = limit.min(20_000);
    Some(
        starts(timeframe, limit)?
            .into_iter()
            .map(|(t, len)| bar(symbol, t, len))
            .collect(),
    )
}

fn bar(symbol: &str, t: i64, len: i64) -> Value {
    let (o, c) = (price_at(symbol, t), price_at(symbol, t + len - 1));
    let mid = price_at(symbol, t + len / 2);
    let hi = o.max(c).max(mid) * 1.002;
    let lo = o.min(c).min(mid) * 0.998;
    json!({
        "time": iso(t),
        "open": o,
        "high": (hi * 10_000.0).round() / 10_000.0,
        "low": (lo * 10_000.0).round() / 10_000.0,
        "close": c,
        "volume": 1000 + (t / 60).rem_euclid(997),
    })
}

/// A daily quote for `symbol` as of the anchor session.
pub fn quote(symbol: &str) -> Value {
    let day = ANCHOR.div_euclid(DAY) * DAY;
    let b = bar(symbol, day, DAY);
    json!({
        "symbol": symbol,
        "time": iso(day),
        "open": b["open"], "high": b["high"], "low": b["low"], "close": b["close"],
        "volume": b["volume"],
        "prev_close": if symbol == "NEWIPO" { Value::Null } else { json!(price_at(symbol, day - DAY)) },
    })
}

pub const WATCHLISTS: [&str; 3] = ["MOMENTUM", "PCT_CHANGE_UP", "SECTOR_AGGREGATE"];

/// REST entries: metrics nested under `fields`, as MarketStore does.
pub fn watchlist_entries(name: &str) -> Vec<Value> {
    let day = ANCHOR.div_euclid(DAY) * DAY;
    let row = |rank: u32, symbol: &str| {
        json!({
            "symbol": symbol, "rank": rank, "sector": "Technology",
            "fields": {
                "price": price_at(symbol, ANCHOR - 60),
                "prior_close": price_at(symbol, day - DAY),
                "open": price_at(symbol, day + OPEN_UTC),
            }
        })
    };
    match name {
        "MOMENTUM" => vec![
            row(1, "AAPL"),
            row(2, "AMD"),
            row(3, "MSFT"),
            row(4, "PENNY"),
        ],
        "PCT_CHANGE_UP" => vec![row(1, "NVDA"), row(2, "TSLA")],
        "SECTOR_AGGREGATE" => vec![
            json!({"symbol": "Technology", "rank": 1, "fields": {"avg_pct_change": 1.23}}),
            json!({"symbol": "Industrials", "rank": 2, "fields": {"avg_pct_change": -0.5}}),
        ],
        _ => vec![],
    }
}

fn position(symbol: &str, qty: f64) -> Value {
    let avg = (base_price(symbol) * 0.95 * 100.0).round() / 100.0;
    let price = price_at(symbol, ANCHOR - 60);
    let mv = price * qty;
    json!({
        "asset_id": format!("asset-{symbol}"), "symbol": symbol, "exchange": "NASDAQ",
        "asset_class": "us_equity", "avg_entry_price": format!("{avg}"),
        "qty": format!("{qty}"), "side": if qty < 0.0 { "short" } else { "long" },
        "market_value": format!("{mv:.2}"), "cost_basis": format!("{:.2}", avg * qty),
        "unrealized_pl": format!("{:.2}", mv - avg * qty), "unrealized_plpc": "0.05",
        "current_price": format!("{price}"), "lastday_price": format!("{price}"), "change_today": "0.01",
    })
}

pub fn positions(a: &FakeAccount) -> Vec<Value> {
    match a.id {
        "PA1TEST" => vec![position("AAPL", 10.0), position("MSFT", -5.0)],
        "LV1TEST" => vec![position("AAPL", 3.0)],
        _ => vec![],
    }
}

pub fn open_orders(a: &FakeAccount) -> Vec<Value> {
    match a.id {
        "PA1TEST" => vec![json!({
            "id": "seed-order-1", "client_order_id": "seed-1", "symbol": "AMD", "type": "limit",
            "side": "buy", "status": "new", "time_in_force": "gtc", "qty": "2",
            "limit_price": "100", "created_at": "2026-09-25T14:00:00Z"
        })],
        _ => vec![],
    }
}

pub fn strategies() -> Vec<Value> {
    vec![
        json!({"broker_id": "alpaca", "account_id": "PA1TEST", "symbol": "AAPL", "strategy": "Momentum"}),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_is_friday_close_and_calendar_math_round_trips() {
        assert_eq!(iso(ANCHOR), "2026-09-25T20:00:00Z");
        assert!(is_weekday(ANCHOR));
        assert!(!is_weekday(ANCHOR + DAY)); // Saturday
        for d in [-800_000, 0, 20_000, 20_721] {
            let (y, m, dd) = civil_from_days(d);
            assert_eq!(days_from_civil(y, m, dd), d);
        }
    }
}
