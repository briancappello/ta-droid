use std::path::PathBuf;

/// Pick the app config to embed (design D8), validate it, and copy it to
/// OUT_DIR as `app-config.toml` for `include_str!`.
///
/// Order: `TA_DROID_CONFIG` if set; the e2e config for `--features e2e`;
/// `config/app-config.toml` if present; else the committed example.
fn select_config() -> PathBuf {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../config");
    println!("cargo:rerun-if-env-changed=TA_DROID_CONFIG");
    println!("cargo:rerun-if-changed={}", root.display());
    if let Ok(p) = std::env::var("TA_DROID_CONFIG") {
        return PathBuf::from(p);
    }
    if std::env::var_os("CARGO_FEATURE_E2E").is_some() {
        return root.join("app-config.e2e.toml");
    }
    let real = root.join("app-config.toml");
    if real.exists() {
        return real;
    }
    root.join("app-config.example.toml")
}

fn main() {
    let path = select_config();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read app config {}: {e}", path.display()));
    if let Err(e) = ta_core::config::AppConfig::parse(&text) {
        panic!("invalid app config {}: {e}", path.display());
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("app-config.toml");
    std::fs::write(out, text).expect("write embedded app config");
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rustc-env=TA_DROID_CONFIG_SOURCE={}", path.display());

    tauri_build::build()
}
