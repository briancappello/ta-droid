//! Pick the secret and preference stores for this platform and build.

use std::path::PathBuf;
use std::sync::Arc;

use ta_core::store::{FileStore, KvStore, SharedStore, StoreError};
use tauri::{AppHandle, Manager};

/// Service name for Secret Service items.
#[cfg_attr(feature = "e2e", allow(dead_code))]
pub const SERVICE: &str = "com.briancappello.ta-droid";

#[cfg_attr(feature = "e2e", allow(dead_code))]
/// A store that fails every call, so provisioning reports `save-failed`
/// instead of the app silently keeping secrets somewhere unsafe.
struct Unavailable(String);

impl KvStore for Unavailable {
    fn get(&self, _: &str) -> Result<Option<String>, StoreError> {
        Err(StoreError::Unavailable(self.0.clone()))
    }
    fn set(&self, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Unavailable(self.0.clone()))
    }
    fn delete(&self, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Unavailable(self.0.clone()))
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // e2e runs point the app at a fresh directory per run.
    #[cfg(feature = "e2e")]
    if let Some(dir) = std::env::var_os("TA_DROID_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().app_data_dir()?)
}

pub fn open(app: &AppHandle) -> Result<(SharedStore, SharedStore), Box<dyn std::error::Error>> {
    let dir = data_dir(app)?;
    let prefs: SharedStore = Arc::new(FileStore::new(dir.join("prefs.json")));
    Ok((secrets(&dir), prefs))
}

#[cfg(feature = "e2e")]
fn secrets(dir: &std::path::Path) -> SharedStore {
    // No Secret Service in headless e2e sessions; test values only.
    Arc::new(FileStore::new(dir.join("e2e-secrets.json")))
}

#[cfg(all(not(feature = "e2e"), target_os = "linux", not(target_os = "android")))]
fn secrets(_: &std::path::Path) -> SharedStore {
    match ta_core::store::KeyringStore::secret_service(SERVICE) {
        Ok(s) => Arc::new(s),
        Err(e) => Arc::new(Unavailable(e.to_string())),
    }
}

#[cfg(all(
    not(feature = "e2e"),
    not(all(target_os = "linux", not(target_os = "android")))
))]
fn secrets(_: &std::path::Path) -> SharedStore {
    // The Android Keystore store arrives in task 6.3.
    Arc::new(Unavailable("no secret store on this platform yet".into()))
}
