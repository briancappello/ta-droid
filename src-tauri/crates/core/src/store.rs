//! Key-value stores for secrets and preferences (design D5).
//!
//! One small trait covers both uses. Secrets go to the platform secret store
//! (Secret Service on Linux, Keystore on Android); preferences such as the
//! active account and profile go to a JSON file. The memory store is for unit
//! tests, and the file store also backs secrets in `e2e` builds, where no
//! Secret Service may be running.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("secret store unavailable: {0}")]
    Unavailable(String),
    #[error("secret store failure: {0}")]
    Backend(String),
    #[error("store file error: {0}")]
    Io(#[from] std::io::Error),
}

/// A string key-value store. Implementations are blocking; call them off the
/// UI thread.
pub trait KvStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, StoreError>;
    fn set(&self, key: &str, value: &str) -> Result<(), StoreError>;
    /// Deleting a missing key is not an error.
    fn delete(&self, key: &str) -> Result<(), StoreError>;
}

pub type SharedStore = Arc<dyn KvStore>;

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<BTreeMap<String, String>>,
}

impl MemoryStore {
    /// Every entry (tests and the e2e leak guard).
    pub fn entries(&self) -> Vec<(String, String)> {
        self.map
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

impl KvStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self.map.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.map.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.map.lock().unwrap().remove(key);
        Ok(())
    }
}

/// A JSON object in one file, rewritten atomically on every change.
pub struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            lock: Mutex::new(()),
        }
    }

    /// Every entry (the e2e leak guard). An unreadable file gives none.
    pub fn entries(&self) -> Vec<(String, String)> {
        let _g = self.lock.lock().unwrap();
        self.load()
            .map(|m| m.into_iter().collect())
            .unwrap_or_default()
    }

    fn load(&self) -> Result<BTreeMap<String, String>, StoreError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn save(&self, map: &BTreeMap<String, String>) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = tmp_path(&self.path);
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(map).expect("map serializes"),
        )?;
        restrict_permissions(&tmp)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_: &Path) -> std::io::Result<()> {
    Ok(())
}

impl KvStore for FileStore {
    fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        let _g = self.lock.lock().unwrap();
        Ok(self.load()?.get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let _g = self.lock.lock().unwrap();
        let mut map = self.load()?;
        map.insert(key.into(), value.into());
        self.save(&map)
    }
    fn delete(&self, key: &str) -> Result<(), StoreError> {
        let _g = self.lock.lock().unwrap();
        let mut map = self.load()?;
        if map.remove(key).is_some() {
            self.save(&map)?;
        }
        Ok(())
    }
}

/// A store over any keyring-core credential store (Secret Service, and the
/// Android Keystore store in task 6.3). Each key is one credential under
/// `service`.
pub struct KeyringStore {
    store: Arc<keyring_core::CredentialStore>,
    service: String,
}

impl KeyringStore {
    pub fn new(store: Arc<keyring_core::CredentialStore>, service: impl Into<String>) -> Self {
        Self {
            store,
            service: service.into(),
        }
    }

    /// The Secret Service (GNOME Keyring, KWallet, ...) through D-Bus.
    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    pub fn secret_service(service: impl Into<String>) -> Result<Self, StoreError> {
        let store = zbus_secret_service_keyring_store::Store::new()
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        Ok(Self::new(store, service))
    }

    fn entry(&self, key: &str) -> Result<keyring_core::Entry, StoreError> {
        self.store
            .build(&self.service, key, None)
            .map_err(|e| StoreError::Backend(e.to_string()))
    }
}

impl KvStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(StoreError::Backend(e.to_string())),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.entry(key)?
            .set_password(value)
            .map_err(|e| StoreError::Backend(e.to_string()))
    }
    fn delete(&self, key: &str) -> Result<(), StoreError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(StoreError::Backend(e.to_string())),
        }
    }
}
