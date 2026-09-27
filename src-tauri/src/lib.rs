use ta_core::config::AppConfig;

/// The build-time app config, validated by build.rs.
pub const APP_CONFIG: &str = include_str!(concat!(env!("OUT_DIR"), "/app-config.toml"));

pub fn app_config() -> AppConfig {
    AppConfig::parse(APP_CONFIG).expect("build.rs validated the embedded config")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _config = app_config();
    tauri::Builder::default()
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
