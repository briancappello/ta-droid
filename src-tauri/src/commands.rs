//! Tauri commands: thin adapters over `AppState`. Nothing here returns a key,
//! secret, header value, or passphrase (app-shell spec: secret boundary).

use ta_core::marketstore::{History, Quote};
use ta_core::profiles::HealthReport;
use ta_core::stream::LiveBar;
use ta_core::watchlists::{WatchRow, WatchlistRef};
use ta_provision::flow::Outcome;
use tauri::State;
use tauri::ipc::Channel;

use ta_core::broker::Order;
use ta_core::broker::flatten::{Leg, SubmitOutcome};
use ta_core::broker::validate::{self, OrderForm};

use crate::state::{AccountsView, AppState, CmdResult, ProfilesView, ProvisioningStatus};
use crate::trading::{HoldingView, OrdersBook, PositionsBook};

#[tauri::command]
pub fn provisioning_status(state: State<'_, AppState>) -> ProvisioningStatus {
    state.provisioning_status()
}

#[tauri::command]
pub async fn provision(state: State<'_, AppState>, passphrase: String) -> CmdResult<Outcome> {
    state.provision(passphrase).await
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> CmdResult<AccountsView> {
    Ok(state.accounts().await)
}

#[tauri::command]
pub async fn set_active_account(state: State<'_, AppState>, id: String) -> CmdResult<AccountsView> {
    state.set_active_account(&id).await
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> CmdResult<ProfilesView> {
    Ok(state.profiles().await)
}

#[tauri::command]
pub async fn set_active_profile(
    state: State<'_, AppState>,
    name: String,
) -> CmdResult<ProfilesView> {
    state.set_active_profile(&name).await
}

#[tauri::command]
pub async fn health(state: State<'_, AppState>) -> CmdResult<HealthReport> {
    Ok(state.health().await)
}

#[tauri::command]
pub async fn history(
    state: State<'_, AppState>,
    symbol: String,
    freq: String,
    limit: Option<usize>,
) -> CmdResult<History> {
    state.history(&symbol, &freq, limit).await
}

#[tauri::command]
pub async fn quotes(state: State<'_, AppState>, symbols: Vec<String>) -> CmdResult<Vec<Quote>> {
    state.quotes(&symbols).await
}

#[tauri::command]
pub async fn watchlists(state: State<'_, AppState>) -> CmdResult<Vec<WatchlistRef>> {
    state.watchlists().await
}

#[tauri::command]
pub async fn watchlist_entries(state: State<'_, AppState>, id: String) -> CmdResult<Vec<WatchRow>> {
    state.watchlist_entries(&id).await
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
    Ok(state
        .subscribe_bars(&symbol, &timeframe, move |b| on_bar.send(b).is_ok())
        .await)
}

#[tauri::command]
pub async fn subscribe_watchlist(
    state: State<'_, AppState>,
    id: String,
    on_rows: Channel<Vec<WatchRow>>,
) -> CmdResult<u64> {
    Ok(state
        .subscribe_watchlist(&id, move |rows| on_rows.send(rows).is_ok())
        .await)
}

#[tauri::command]
pub fn unsubscribe(state: State<'_, AppState>, id: u64) {
    state.unsubscribe(id);
}

#[tauri::command]
pub async fn positions(state: State<'_, AppState>) -> CmdResult<PositionsBook> {
    Ok(state.positions().await)
}

#[tauri::command]
pub async fn orders(state: State<'_, AppState>) -> CmdResult<OrdersBook> {
    Ok(state.orders().await)
}

#[tauri::command]
pub async fn symbol_holdings(
    state: State<'_, AppState>,
    symbol: String,
) -> CmdResult<Vec<HoldingView>> {
    Ok(state.symbol_holdings(&symbol).await)
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
    state.place_order(&account_id, &form).await
}

#[tauri::command]
pub async fn flatten_legs(state: State<'_, AppState>, symbol: String) -> CmdResult<Vec<Leg>> {
    Ok(state.flatten_legs(&symbol).await)
}

#[tauri::command]
pub async fn submit_flatten(
    state: State<'_, AppState>,
    legs: Vec<Leg>,
) -> CmdResult<SubmitOutcome> {
    Ok(state.submit_flatten(legs).await)
}
