//! Tauri commands: thin adapters over `AppState`. Nothing here returns a key,
//! secret, header value, or passphrase (app-shell spec: secret boundary).
//! In `e2e` builds every result and channel message also passes the leak
//! guard.

use ta_core::broker::Order;
use ta_core::broker::flatten::{Leg, SubmitOutcome};
use ta_core::broker::validate::{self, OrderForm};
use ta_core::marketstore::{History, Quote};
use ta_core::profiles::HealthReport;
use ta_core::stream::LiveBar;
use ta_core::watchlists::{WatchRow, WatchlistRef};
use ta_provision::flow::Outcome;
use tauri::State;
use tauri::ipc::Channel;

use crate::leak_guard::{allow, check, secret_values};
use crate::state::{AccountsView, AppState, CmdResult, ProfilesView, ProvisioningStatus};
use crate::trading::{HoldingView, OrdersBook, PositionsBook};

#[tauri::command]
pub fn provisioning_status(state: State<'_, AppState>) -> CmdResult<ProvisioningStatus> {
    check(
        &state,
        "provisioning_status",
        Ok(state.provisioning_status()),
    )
}

#[tauri::command]
pub async fn provision(state: State<'_, AppState>, passphrase: String) -> CmdResult<Outcome> {
    let r = state.provision(passphrase).await;
    check(&state, "provision", r)
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> CmdResult<AccountsView> {
    let r = Ok(state.accounts().await);
    check(&state, "list_accounts", r)
}

#[tauri::command]
pub async fn set_active_account(state: State<'_, AppState>, id: String) -> CmdResult<AccountsView> {
    let r = state.set_active_account(&id).await;
    check(&state, "set_active_account", r)
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> CmdResult<ProfilesView> {
    let r = Ok(state.profiles().await);
    check(&state, "list_profiles", r)
}

#[tauri::command]
pub async fn set_active_profile(
    state: State<'_, AppState>,
    name: String,
) -> CmdResult<ProfilesView> {
    let r = state.set_active_profile(&name).await;
    check(&state, "set_active_profile", r)
}

#[tauri::command]
pub async fn health(state: State<'_, AppState>) -> CmdResult<HealthReport> {
    let r = Ok(state.health().await);
    check(&state, "health", r)
}

#[tauri::command]
pub async fn history(
    state: State<'_, AppState>,
    symbol: String,
    freq: String,
    limit: Option<usize>,
) -> CmdResult<History> {
    let r = state.history(&symbol, &freq, limit).await;
    check(&state, "history", r)
}

#[tauri::command]
pub async fn quotes(state: State<'_, AppState>, symbols: Vec<String>) -> CmdResult<Vec<Quote>> {
    let r = state.quotes(&symbols).await;
    check(&state, "quotes", r)
}

#[tauri::command]
pub async fn watchlists(state: State<'_, AppState>) -> CmdResult<Vec<WatchlistRef>> {
    let r = state.watchlists().await;
    check(&state, "watchlists", r)
}

#[tauri::command]
pub async fn watchlist_entries(state: State<'_, AppState>, id: String) -> CmdResult<Vec<WatchRow>> {
    let r = state.watchlist_entries(&id).await;
    check(&state, "watchlist_entries", r)
}

/// Live bars for `symbol` at a MarketStore timeframe. Returns an id for
/// `unsubscribe`; the UI must call it when the view goes away.
#[tauri::command]
pub async fn subscribe_bars(
    state: State<'_, AppState>,
    symbol: String,
    timeframe: String,
    on_bar: Channel<LiveBar>,
) -> CmdResult<u64> {
    let secrets = secret_values(&state);
    Ok(state
        .subscribe_bars(&symbol, &timeframe, move |b| {
            !allow(&secrets, "bars", &b) || on_bar.send(b).is_ok()
        })
        .await)
}

#[tauri::command]
pub async fn subscribe_watchlist(
    state: State<'_, AppState>,
    id: String,
    on_rows: Channel<Vec<WatchRow>>,
) -> CmdResult<u64> {
    let secrets = secret_values(&state);
    Ok(state
        .subscribe_watchlist(&id, move |rows| {
            !allow(&secrets, "watchlist", &rows) || on_rows.send(rows).is_ok()
        })
        .await)
}

#[tauri::command]
pub fn unsubscribe(state: State<'_, AppState>, id: u64) {
    state.unsubscribe(id);
}

#[tauri::command]
pub async fn positions(state: State<'_, AppState>) -> CmdResult<PositionsBook> {
    let r = Ok(state.positions().await);
    check(&state, "positions", r)
}

#[tauri::command]
pub async fn orders(state: State<'_, AppState>) -> CmdResult<OrdersBook> {
    let r = Ok(state.orders().await);
    check(&state, "orders", r)
}

#[tauri::command]
pub async fn symbol_holdings(
    state: State<'_, AppState>,
    symbol: String,
) -> CmdResult<Vec<HoldingView>> {
    let r = Ok(state.symbol_holdings(&symbol).await);
    check(&state, "symbol_holdings", r)
}

/// Live form feedback; the same checks run again in `place_order`.
#[tauri::command]
pub fn validate_order(form: OrderForm) -> Vec<String> {
    validate::validate(&form)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[tauri::command]
pub async fn place_order(
    state: State<'_, AppState>,
    account_id: String,
    form: OrderForm,
) -> CmdResult<Order> {
    let r = state.place_order(&account_id, &form).await;
    check(&state, "place_order", r)
}

#[tauri::command]
pub async fn flatten_legs(state: State<'_, AppState>, symbol: String) -> CmdResult<Vec<Leg>> {
    let r = Ok(state.flatten_legs(&symbol).await);
    check(&state, "flatten_legs", r)
}

#[tauri::command]
pub async fn submit_flatten(
    state: State<'_, AppState>,
    legs: Vec<Leg>,
) -> CmdResult<SubmitOutcome> {
    let r = Ok(state.submit_flatten(legs).await);
    check(&state, "submit_flatten", r)
}

/// e2e builds only: reset to a fresh install so a spec can see the gate.
#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_reset(state: State<'_, AppState>) -> CmdResult<()> {
    state.e2e_reset().await
}
