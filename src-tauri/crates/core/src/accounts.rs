//! Accounts: build-time metadata joined with provisioned credentials
//! (accounts spec). Keys and secrets stay in the backend; the UI gets
//! [`AccountView`].

use crate::config::{AccountMeta, BrokerId};
use crate::keys;
use crate::store::KvStore;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A usable account, including its credentials. Never sent to the UI.
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
pub struct Account {
    #[zeroize(skip)]
    pub broker: BrokerId,
    pub id: String,
    pub name: String,
    #[zeroize(skip)]
    pub is_paper: bool,
    pub key: String,
    pub secret: String,
}

impl std::fmt::Debug for Account {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Account")
            .field("broker", &self.broker)
            .field("id", &self.id)
            .field("name", &self.name)
            .field("is_paper", &self.is_paper)
            .finish_non_exhaustive()
    }
}

/// What the UI may know about an account.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub broker: BrokerId,
    pub is_paper: bool,
    /// Last (up to) four characters of the API key, for `••••1234`.
    pub key_last4: String,
}

impl Account {
    pub fn view(&self) -> AccountView {
        let n = self.key.chars().count();
        AccountView {
            id: self.id.clone(),
            name: self.name.clone(),
            broker: self.broker,
            is_paper: self.is_paper,
            key_last4: self.key.chars().skip(n.saturating_sub(4)).collect(),
        }
    }
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct StoredCred {
    key: String,
    secret: String,
}

/// Accounts whose credentials are provisioned, in config order. A missing,
/// unreadable, or malformed credential skips that account.
pub fn load(meta: &[AccountMeta], secrets: &dyn KvStore) -> Vec<Account> {
    meta.iter()
        .filter_map(|m| {
            let raw = secrets.get(&keys::credential(m.broker, &m.id)).ok()??;
            let cred: StoredCred = serde_json::from_str(&raw).ok()?;
            Some(Account {
                broker: m.broker,
                id: m.id.clone(),
                name: m.name.clone(),
                is_paper: m.is_paper,
                key: cred.key.clone(),
                secret: cred.secret.clone(),
            })
        })
        .collect()
}

/// The active account id: the persisted one if it is still loaded, else the
/// first account, else none.
pub fn active_id(accounts: &[Account], prefs: &dyn KvStore) -> Option<String> {
    let persisted = prefs.get(keys::ACTIVE_ACCOUNT).ok().flatten();
    persisted
        .filter(|id| accounts.iter().any(|a| &a.id == id))
        .or_else(|| accounts.first().map(|a| a.id.clone()))
}

/// Persist the active account id. A failed write is ignored (accounts spec).
pub fn set_active_id(prefs: &dyn KvStore, id: &str) {
    let _ = prefs.set(keys::ACTIVE_ACCOUNT, id);
}
