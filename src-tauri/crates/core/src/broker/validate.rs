//! Order form validation and request building (trading spec). The UI calls
//! this for live feedback, and the backend runs it again on submit.

use serde::{Deserialize, Serialize};

use super::{NewOrderRequest, OrderSide, OrderType, TimeInForce};

/// The order form as the user filled it in. Numbers are the raw text.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderForm {
    pub symbol: String,
    pub side: OrderSide,
    #[serde(rename = "type")]
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    #[serde(default)]
    pub qty: String,
    #[serde(default)]
    pub notional: String,
    #[serde(default)]
    pub limit_price: String,
    #[serde(default)]
    pub stop_price: String,
    #[serde(default)]
    pub trail_percent: String,
    #[serde(default)]
    pub extended_hours: bool,
    #[serde(default)]
    pub use_notional: bool,
}

fn is_positive(s: &str) -> bool {
    s.trim()
        .parse::<f64>()
        .is_ok_and(|n| n.is_finite() && n > 0.0)
}

fn needs_limit(t: OrderType) -> bool {
    matches!(t, OrderType::Limit | OrderType::StopLimit)
}
fn needs_stop(t: OrderType) -> bool {
    matches!(t, OrderType::Stop | OrderType::StopLimit)
}
fn needs_trail(t: OrderType) -> bool {
    t == OrderType::TrailingStop
}

/// Every problem with the form, in display order. Empty means valid.
pub fn validate(f: &OrderForm) -> Vec<&'static str> {
    let mut errors = Vec::new();
    if f.symbol.trim().is_empty() {
        errors.push("Symbol is required.");
    }
    if f.use_notional {
        if !is_positive(&f.notional) {
            errors.push("Notional must be a positive number.");
        }
    } else if !is_positive(&f.qty) {
        errors.push("Quantity must be a positive number.");
    }
    if needs_limit(f.order_type) && !is_positive(&f.limit_price) {
        errors.push("Limit price is required for limit orders.");
    }
    if needs_stop(f.order_type) && !is_positive(&f.stop_price) {
        errors.push("Stop price is required for stop orders.");
    }
    if needs_trail(f.order_type) && !is_positive(&f.trail_percent) {
        errors.push("Trail percent is required for trailing stop orders.");
    }
    errors
}

/// The request for a valid form: trimmed, uppercased symbol; qty or
/// notional; only the price fields the type needs.
pub fn to_request(f: &OrderForm) -> NewOrderRequest {
    let t = f.order_type;
    let keep = |on: bool, v: &str| on.then(|| v.trim().to_owned());
    NewOrderRequest {
        symbol: f.symbol.trim().to_uppercase(),
        side: f.side,
        order_type: t,
        time_in_force: f.time_in_force,
        qty: keep(!f.use_notional, &f.qty),
        notional: keep(f.use_notional, &f.notional),
        limit_price: keep(needs_limit(t), &f.limit_price),
        stop_price: keep(needs_stop(t), &f.stop_price),
        trail_percent: keep(needs_trail(t), &f.trail_percent),
        extended_hours: Some(f.extended_hours),
        client_order_id: None,
    }
}
