//! Application state behind the Tauri commands. Everything here is plain
//! Rust so it is tested without a window; `commands.rs` only adapts it to IPC.

use serde::Serialize;
use ta_core::accounts::{self, Account, AccountView};
use ta_core::broker::alpaca::Alpaca;
use ta_core::config::AppConfig;
use ta_core::profiles::{self, Backend, HealthReport, ProfileView};
use ta_core::store::SharedStore;
use ta_core::stream::{StreamClient, StreamConfig};
use ta_provision::flow::{self, Action, Outcome};
use tokio::sync::RwLock;

/// Error shown to the UI. Carries a user-facing message only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS, thiserror::Error)]
#[ts(export)]
#[error("{message}")]
pub struct CmdError {
    pub message: String,
}

impl CmdError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ProvisioningStatus {
    /// True when the passphrase prompt must be shown before anything else.
    pub needed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AccountsView {
    pub accounts: Vec<AccountView>,
    pub active_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ProfilesView {
    pub profiles: Vec<ProfileView>,
    pub active: String,
}

/// State that changes with provisioning and the active profile.
pub struct Live {
    pub accounts: Vec<Account>,
    pub backend: Backend,
    pub stream: StreamClient,
    pub alpaca: Alpaca,
}

pub struct AppState {
    pub config: AppConfig,
    pub secrets: SharedStore,
    pub prefs: SharedStore,
    pub live: RwLock<Live>,
}

fn backend_for(
    config: &AppConfig,
    prefs: &SharedStore,
    secrets: &SharedStore,
) -> CmdResult<(Backend, StreamClient)> {
    let profile = profiles::active(config, prefs.as_ref());
    let backend =
        Backend::new(profile, secrets.as_ref()).map_err(|e| CmdError::new(e.to_string()))?;
    let stream = StreamClient::spawn(
        StreamConfig::for_backend(&backend).map_err(|e| CmdError::new(e.to_string()))?,
    );
    Ok((backend, stream))
}

impl AppState {
    /// Build the state. Must run inside the Tokio runtime (the stream task).
    pub fn new(config: AppConfig, secrets: SharedStore, prefs: SharedStore) -> CmdResult<Self> {
        let accounts = accounts::load(&config.accounts, secrets.as_ref());
        let (backend, stream) = backend_for(&config, &prefs, &secrets)?;
        let alpaca = Alpaca::new(
            config
                .broker_hosts(ta_core::config::BrokerId::Alpaca)
                .clone(),
        )
        .map_err(|e| CmdError::new(e.to_string()))?;
        Ok(Self {
            live: RwLock::new(Live {
                accounts,
                backend,
                stream,
                alpaca,
            }),
            config,
            secrets,
            prefs,
        })
    }

    pub fn provisioning_status(&self) -> ProvisioningStatus {
        let stored = flow::stored_fingerprint(self.secrets.as_ref());
        ProvisioningStatus {
            needed: flow::action(self.config.credentials_blob.as_ref(), stored.as_deref())
                == Action::Provision,
        }
    }

    /// Decrypt and store the shipped blob, then reload accounts and the
    /// backend (its auth headers may be new).
    pub async fn provision(&self, passphrase: String) -> CmdResult<Outcome> {
        let Some(blob) = self.config.credentials_blob.clone() else {
            return Ok(Outcome::Ok);
        };
        let secrets = self.secrets.clone();
        // Argon2 at 256 MiB takes seconds: keep it off the async workers.
        let outcome =
            tokio::task::spawn_blocking(move || flow::run(&blob, &passphrase, secrets.as_ref()))
                .await
                .map_err(|_| CmdError::new("Provisioning was interrupted."))?;
        if outcome == Outcome::Ok {
            self.reload().await?;
        }
        Ok(outcome)
    }

    async fn reload(&self) -> CmdResult<()> {
        let accounts = accounts::load(&self.config.accounts, self.secrets.as_ref());
        let (backend, stream) = backend_for(&self.config, &self.prefs, &self.secrets)?;
        let mut live = self.live.write().await;
        live.accounts = accounts;
        live.backend = backend;
        live.stream = stream;
        Ok(())
    }

    pub async fn accounts(&self) -> AccountsView {
        let live = self.live.read().await;
        AccountsView {
            accounts: live.accounts.iter().map(Account::view).collect(),
            active_id: accounts::active_id(&live.accounts, self.prefs.as_ref()),
        }
    }

    pub async fn set_active_account(&self, id: &str) -> CmdResult<AccountsView> {
        if !self.live.read().await.accounts.iter().any(|a| a.id == id) {
            return Err(CmdError::new("Unknown account."));
        }
        accounts::set_active_id(self.prefs.as_ref(), id);
        Ok(self.accounts().await)
    }

    pub async fn profiles(&self) -> ProfilesView {
        let live = self.live.read().await;
        ProfilesView {
            profiles: self.config.profiles.iter().map(ProfileView::from).collect(),
            active: live.backend.profile.name.clone(),
        }
    }

    /// Switch profiles: persist, then rebuild the backend and the stream
    /// (dropping the old stream closes its socket once its subscriptions go).
    pub async fn set_active_profile(&self, name: &str) -> CmdResult<ProfilesView> {
        profiles::set_active(&self.config, self.prefs.as_ref(), name)
            .map_err(|e| CmdError::new(e.to_string()))?;
        self.reload().await?;
        Ok(self.profiles().await)
    }

    pub async fn health(&self) -> HealthReport {
        let backend = self.live.read().await.backend.clone();
        profiles::health(&backend).await
    }
}
