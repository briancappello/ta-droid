//! fa-techan client and strategy tagging (backend-profiles spec: fa-techan
//! is enrichment only; trading spec: strategy tags).
//!
//! Every call resolves to a safe empty result on any failure. No broker
//! credential is ever sent here.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::accounts::Account;
use crate::profiles::Backend;

pub const UNATTRIBUTED: &str = "Unattributed";
pub const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StrategyPosition {
    #[serde(default)]
    pub broker_id: String,
    pub account_id: String,
    pub symbol: String,
    pub strategy: String,
}

/// `GET /strategies/positions`; `[]` on any failure.
pub async fn strategy_positions(b: &Backend) -> Vec<StrategyPosition> {
    strategy_positions_within(b, TIMEOUT).await
}

/// [`strategy_positions`] with a custom timeout.
pub async fn strategy_positions_within(b: &Backend, timeout: Duration) -> Vec<StrategyPosition> {
    let Ok(res) = b
        .client()
        .get(b.fatechan_url("/strategies/positions"))
        .timeout(timeout)
        .send()
        .await
    else {
        return Vec::new();
    };
    if !res.status().is_success() {
        return Vec::new();
    }
    res.json().await.unwrap_or_default()
}

/// Tags rows by the case-sensitive key `broker:account_id:symbol`.
#[derive(Debug, Clone, Default)]
pub struct Tagger {
    map: HashMap<String, String>,
}

impl Tagger {
    pub fn new(rows: &[StrategyPosition]) -> Self {
        Self {
            map: rows
                .iter()
                .map(|r| {
                    (
                        format!("{}:{}:{}", r.broker_id, r.account_id, r.symbol),
                        r.strategy.clone(),
                    )
                })
                .collect(),
        }
    }

    pub fn tag(&self, account: &Account, symbol: &str) -> String {
        self.map
            .get(&format!(
                "{}:{}:{}",
                account.broker.as_str(),
                account.id,
                symbol
            ))
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| UNATTRIBUTED.to_owned())
    }
}

/// Fetch and build a tagger in one step.
pub async fn load_tagger(b: &Backend) -> Tagger {
    Tagger::new(&strategy_positions(b).await)
}
