//! Tauri commands: thin adapters over `AppState`. Nothing here returns a key,
//! secret, header value, or passphrase (app-shell spec: secret boundary).

use ta_core::profiles::HealthReport;
use ta_provision::flow::Outcome;
use tauri::State;

use crate::state::{AccountsView, AppState, CmdResult, ProfilesView, ProvisioningStatus};

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
