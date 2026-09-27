//! Broker access (trading spec). Alpaca is the only broker; `BrokerId` makes
//! an unknown broker unrepresentable.

pub mod alpaca;
pub mod flatten;
pub mod validate;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderSide {
    Buy,
    Sell,
}

impl OrderSide {
    pub fn opposite(self) -> Self {
        match self {
            OrderSide::Buy => OrderSide::Sell,
            OrderSide::Sell => OrderSide::Buy,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    Market,
    Limit,
    Stop,
    StopLimit,
    TrailingStop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeInForce {
    Day,
    Gtc,
    Opg,
    Cls,
    Ioc,
    Fok,
}

/// An open position (GET /v2/positions element). Alpaca numerics are
/// strings; enum-like fields stay strings so new wire values never break
/// parsing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub qty: String,
    pub side: String,
    pub avg_entry_price: String,
    pub market_value: String,
    pub unrealized_pl: String,
    #[serde(default)]
    pub asset_id: Option<String>,
    #[serde(default)]
    pub exchange: Option<String>,
    #[serde(default)]
    pub asset_class: Option<String>,
    #[serde(default)]
    pub qty_available: Option<String>,
    #[serde(default)]
    pub cost_basis: Option<String>,
    #[serde(default)]
    pub unrealized_plpc: Option<String>,
    #[serde(default)]
    pub current_price: Option<String>,
    #[serde(default)]
    pub lastday_price: Option<String>,
    #[serde(default)]
    pub change_today: Option<String>,
}

/// An order (GET/POST /v2/orders element), reduced to what the app reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    #[serde(default)]
    pub client_order_id: Option<String>,
    pub symbol: String,
    #[serde(rename = "type")]
    pub order_type: String,
    pub side: String,
    pub status: String,
    #[serde(default)]
    pub time_in_force: Option<String>,
    #[serde(default)]
    pub qty: Option<String>,
    #[serde(default)]
    pub notional: Option<String>,
    #[serde(default)]
    pub filled_qty: Option<String>,
    #[serde(default)]
    pub limit_price: Option<String>,
    #[serde(default)]
    pub stop_price: Option<String>,
    #[serde(default)]
    pub trail_percent: Option<String>,
    #[serde(default)]
    pub trail_price: Option<String>,
    #[serde(default)]
    pub extended_hours: Option<bool>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// POST /v2/orders body. Fields a type does not need are left out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewOrderRequest {
    pub symbol: String,
    pub side: OrderSide,
    #[serde(rename = "type")]
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub qty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub notional: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub limit_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stop_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trail_percent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extended_hours: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub client_order_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderQueryStatus {
    #[default]
    Open,
    Closed,
    All,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderFilter {
    #[serde(default)]
    pub status: OrderQueryStatus,
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub direction: Option<String>,
}

/// PATCH /v2/orders/{id} body.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplaceOrderRequest {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub qty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub time_in_force: Option<TimeInForce>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub limit_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stop_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trail: Option<String>,
}
