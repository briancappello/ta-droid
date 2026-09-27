pub mod commands;
pub mod state;
mod stores;
pub mod trading;

use ta_core::config::AppConfig;
use tauri::Manager;

/// The build-time app config, validated by build.rs.
pub const APP_CONFIG: &str = include_str!(concat!(env!("OUT_DIR"), "/app-config.toml"));

pub fn app_config() -> AppConfig {
    AppConfig::parse(APP_CONFIG).expect("build.rs validated the embedded config")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ta_core::net::install_default_crypto_provider();
    tauri::Builder::default()
        .setup(|app| {
            let (secrets, prefs) = stores::open(app.handle())?;
            let state = tauri::async_runtime::block_on(async {
                state::AppState::new(app_config(), secrets, prefs)
            })
            .map_err(|e| e.message)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::provisioning_status,
            commands::provision,
            commands::list_accounts,
            commands::set_active_account,
            commands::list_profiles,
            commands::set_active_profile,
            commands::health,
            commands::history,
            commands::quotes,
            commands::watchlists,
            commands::watchlist_entries,
            commands::subscribe_bars,
            commands::subscribe_watchlist,
            commands::unsubscribe,
            commands::positions,
            commands::orders,
            commands::symbol_holdings,
            commands::validate_order,
            commands::place_order,
            commands::flatten_legs,
            commands::submit_flatten,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ta-droid application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn embedded_config_parses() {
        let cfg = super::app_config();
        assert!(!cfg.profiles.is_empty());
        #[cfg(feature = "e2e")]
        assert_eq!(cfg.profiles[0].name, "e2e");
    }
}
