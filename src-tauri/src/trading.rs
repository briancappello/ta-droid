//! Trading operations behind the commands (trading spec). Results name
//! accounts by id and view only; credentials never leave the backend.

use futures::future::join_all;
use serde::Serialize;
use ta_core::accounts::{Account, AccountView};
use ta_core::broker::flatten::{self, Leg, SubmitOutcome};
use ta_core::broker::validate::{self, OrderForm};
use ta_core::broker::{Order, OrderFilter, Position};
use ta_core::techan;

use crate::state::{AppState, CmdError, CmdResult};

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct Tagged<T> {
    pub item: T,
    pub strategy: String,
}

/// One account's rows, or the error that kept them from loading.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AccountBook<T> {
    pub account: AccountView,
    pub rows: Vec<Tagged<T>>,
    pub error: Option<String>,
}

pub type PositionsBook = Vec<AccountBook<Position>>;
pub type OrdersBook = Vec<AccountBook<Order>>;

/// One account's holding of a symbol, for the chart strip.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct HoldingView {
    pub account_id: String,
    pub account_name: String,
    pub is_paper: bool,
    pub qty: String,
    pub avg_entry_price: String,
    pub unrealized_pl: String,
}

impl AppState {
    /// Tests only: a shorter broker timeout, to exercise the timeout path.
    #[doc(hidden)]
    pub async fn set_broker_timeout(&self, timeout: std::time::Duration) {
        let hosts = self
            .config
            .broker_hosts(ta_core::config::BrokerId::Alpaca)
            .clone();
        self.live.write().await.alpaca =
            ta_core::broker::alpaca::Alpaca::with_timeout(hosts, timeout).expect("client builds");
    }

    async fn accounts_snapshot(
        &self,
    ) -> (
        Vec<Account>,
        ta_core::broker::alpaca::Alpaca,
        ta_core::profiles::Backend,
    ) {
        let live = self.live.read().await;
        (
            live.accounts.clone(),
            live.alpaca.clone(),
            live.backend.clone(),
        )
    }

    pub async fn positions(&self) -> PositionsBook {
        let (accounts, alpaca, backend) = self.accounts_snapshot().await;
        let (tagger, results) = tokio::join!(
            techan::load_tagger(&backend),
            join_all(accounts.iter().map(|a| alpaca.list_positions(a)))
        );
        accounts
            .iter()
            .zip(results)
            .map(|(a, r)| {
                book(a, r.map_err(|e| e.message), |p: &Position| {
                    tagger.tag(a, &p.symbol)
                })
            })
            .collect()
    }

    pub async fn orders(&self) -> OrdersBook {
        let (accounts, alpaca, backend) = self.accounts_snapshot().await;
        let filter = OrderFilter::default();
        let (tagger, results) = tokio::join!(
            techan::load_tagger(&backend),
            join_all(accounts.iter().map(|a| alpaca.list_orders(a, &filter)))
        );
        accounts
            .iter()
            .zip(results)
            .map(|(a, r)| {
                // Only working orders, even if the broker returns others.
                let r = r.map(|os| os.into_iter().filter(|o| is_open(&o.status)).collect());
                book(a, r.map_err(|e| e.message), |o: &Order| {
                    tagger.tag(a, &o.symbol)
                })
            })
            .collect()
    }

    pub async fn symbol_holdings(&self, symbol: &str) -> Vec<HoldingView> {
        let (accounts, alpaca, _) = self.accounts_snapshot().await;
        flatten::holdings(&alpaca, &accounts, symbol)
            .await
            .into_iter()
            .map(|h| HoldingView {
                account_id: h.account.id.clone(),
                account_name: h.account.name.clone(),
                is_paper: h.account.is_paper,
                qty: h.position.qty,
                avg_entry_price: h.position.avg_entry_price,
                unrealized_pl: h.position.unrealized_pl,
            })
            .collect()
    }

    /// Place an order after validating it again here.
    pub async fn place_order(&self, account_id: &str, form: &OrderForm) -> CmdResult<Order> {
        if let Some(first) = validate::validate(form).first() {
            return Err(CmdError::new(*first));
        }
        let (accounts, alpaca, _) = self.accounts_snapshot().await;
        let account = accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or_else(|| CmdError::new("Select an account."))?;
        alpaca
            .create_order(account, &validate::to_request(form))
            .await
            .map_err(|e| CmdError::new(e.message))
    }

    pub async fn flatten_legs(&self, symbol: &str) -> Vec<Leg> {
        let (accounts, alpaca, _) = self.accounts_snapshot().await;
        flatten::plan(&flatten::holdings(&alpaca, &accounts, symbol).await)
    }

    pub async fn submit_flatten(&self, legs: Vec<Leg>) -> SubmitOutcome {
        let (accounts, alpaca, _) = self.accounts_snapshot().await;
        flatten::submit(&alpaca, &accounts, legs).await
    }
}

fn is_open(status: &str) -> bool {
    !matches!(
        status,
        "filled"
            | "canceled"
            | "expired"
            | "rejected"
            | "replaced"
            | "done_for_day"
            | "stopped"
            | "suspended"
            | "calculated"
    )
}

fn book<T>(
    account: &Account,
    rows: Result<Vec<T>, String>,
    tag: impl Fn(&T) -> String,
) -> AccountBook<T> {
    match rows {
        Ok(items) => AccountBook {
            account: account.view(),
            rows: items
                .into_iter()
                .map(|item| Tagged {
                    strategy: tag(&item),
                    item,
                })
                .collect(),
            error: None,
        },
        Err(e) => AccountBook {
            account: account.view(),
            rows: Vec::new(),
            error: Some(e),
        },
    }
}
