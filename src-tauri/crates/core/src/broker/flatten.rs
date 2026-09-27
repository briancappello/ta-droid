//! Exit a symbol across accounts (trading spec: Exit a symbol).

use futures::future::join_all;
use serde::{Deserialize, Serialize};

use super::alpaca::{Alpaca, AlpacaError, new_client_order_id};
use super::{NewOrderRequest, OrderSide, OrderType, Position, TimeInForce};
use crate::accounts::Account;

/// One account's position in the symbol.
#[derive(Debug, Clone)]
pub struct Holding<'a> {
    pub account: &'a Account,
    pub position: Position,
}

/// One exit order. Carries no secrets: the backend looks the account up by
/// id when it submits.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Leg {
    pub account_id: String,
    pub account_name: String,
    pub is_paper: bool,
    pub req: NewOrderRequest,
}

#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegResult {
    pub account_id: String,
    pub account_name: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SubmitOutcome {
    pub results: Vec<LegResult>,
    /// The legs that failed, unchanged; submitting them again retries only
    /// those (and with the same client order ids, so a leg that did reach
    /// Alpaca is rejected rather than duplicated).
    pub remaining: Vec<Leg>,
    pub all_ok: bool,
}

/// Every account's position in `symbol`. An account that fails to load is
/// skipped.
pub async fn holdings<'a>(
    alpaca: &Alpaca,
    accounts: &'a [Account],
    symbol: &str,
) -> Vec<Holding<'a>> {
    let all = join_all(accounts.iter().map(|a| alpaca.list_positions(a))).await;
    accounts
        .iter()
        .zip(all)
        .filter_map(|(account, r)| {
            let position = r.ok()?.into_iter().find(|p| p.symbol == symbol)?;
            Some(Holding { account, position })
        })
        .collect()
}

fn abs_qty(qty: &str) -> String {
    match qty.trim().parse::<f64>() {
        Ok(n) => n.abs().to_string(),
        Err(_) => qty.trim_start_matches('-').to_owned(),
    }
}

/// One market DAY order per holding, on the opposite side, for |qty|.
pub fn plan(holdings: &[Holding<'_>]) -> Vec<Leg> {
    holdings
        .iter()
        .map(|h| Leg {
            account_id: h.account.id.clone(),
            account_name: h.account.name.clone(),
            is_paper: h.account.is_paper,
            req: NewOrderRequest {
                symbol: h.position.symbol.clone(),
                side: if h.position.side == "short" {
                    OrderSide::Buy
                } else {
                    OrderSide::Sell
                },
                order_type: OrderType::Market,
                time_in_force: TimeInForce::Day,
                qty: Some(abs_qty(&h.position.qty)),
                notional: None,
                limit_price: None,
                stop_price: None,
                trail_percent: None,
                extended_hours: None,
                client_order_id: Some(new_client_order_id()),
            },
        })
        .collect()
}

/// Send every leg in parallel; each gets its own result.
pub async fn submit(alpaca: &Alpaca, accounts: &[Account], legs: Vec<Leg>) -> SubmitOutcome {
    let sends = legs.iter().map(|leg| async move {
        let Some(account) = accounts.iter().find(|a| a.id == leg.account_id) else {
            return Err(AlpacaError {
                status: 0,
                message: "This account is no longer available.".into(),
            });
        };
        alpaca.create_order(account, &leg.req).await.map(|_| ())
    });
    let outcomes = join_all(sends).await;
    let mut results = Vec::with_capacity(legs.len());
    let mut remaining = Vec::new();
    for (leg, r) in legs.into_iter().zip(outcomes) {
        results.push(LegResult {
            account_id: leg.account_id.clone(),
            account_name: leg.account_name.clone(),
            ok: r.is_ok(),
            error: r.as_ref().err().map(|e| e.message.clone()),
        });
        if r.is_err() {
            remaining.push(leg);
        }
    }
    SubmitOutcome {
        all_ok: remaining.is_empty(),
        results,
        remaining,
    }
}
