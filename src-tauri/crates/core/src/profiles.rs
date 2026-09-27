//! Backend profiles and health (backend-profiles spec).

use std::time::Duration;

use serde::Serialize;

use crate::config::{AppConfig, Profile};
use crate::keys;
use crate::net::{self, ClientOptions, NetError};
use crate::store::KvStore;

/// The active profile: the persisted one if it still exists, else the first.
pub fn active<'a>(cfg: &'a AppConfig, prefs: &dyn KvStore) -> &'a Profile {
    prefs
        .get(keys::ACTIVE_PROFILE)
        .ok()
        .flatten()
        .and_then(|name| cfg.profile(&name))
        .unwrap_or(&cfg.profiles[0])
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("no backend profile named `{0}`")]
pub struct UnknownProfile(pub String);

/// Make `name` the active profile and persist it. A failed write still
/// switches for this session (the caller holds the new backend).
pub fn set_active<'a>(
    cfg: &'a AppConfig,
    prefs: &dyn KvStore,
    name: &str,
) -> Result<&'a Profile, UnknownProfile> {
    let p = cfg
        .profile(name)
        .ok_or_else(|| UnknownProfile(name.to_owned()))?;
    let _ = prefs.set(keys::ACTIVE_PROFILE, name);
    Ok(p)
}

/// What the UI may know about a profile: no header values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProfileView {
    pub name: String,
    pub marketstore_url: String,
    pub fatechan_url: String,
    pub has_auth: bool,
    pub has_custom_ca: bool,
}

impl From<&Profile> for ProfileView {
    fn from(p: &Profile) -> Self {
        Self {
            name: p.name.clone(),
            marketstore_url: p.marketstore_url.clone(),
            fatechan_url: p.fatechan_url.clone(),
            has_auth: !p.auth_headers.is_empty(),
            has_custom_ca: p.ca_cert_pem.is_some(),
        }
    }
}

/// HTTP access to one profile's MarketStore and fa-techan, with its auth
/// headers and CA applied.
#[derive(Clone)]
pub struct Backend {
    pub profile: Profile,
    client: reqwest::Client,
    headers: Vec<(String, String)>,
}

impl std::fmt::Debug for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Backend")
            .field("profile", &self.profile.name)
            .finish_non_exhaustive()
    }
}

impl Backend {
    /// Header values come from the secret store; a header whose value is not
    /// provisioned is left out.
    pub fn new(profile: &Profile, secrets: &dyn KvStore) -> Result<Self, NetError> {
        let headers: Vec<(String, String)> = profile
            .auth_headers
            .iter()
            .filter_map(|h| {
                let v = secrets
                    .get(&keys::backend_header(&profile.name, h))
                    .ok()??;
                Some((h.clone(), v))
            })
            .collect();
        let client = net::http_client(ClientOptions {
            extra_ca_pem: profile.ca_cert_pem.as_deref(),
            headers: &headers,
            timeout: None,
            follow_redirects: true,
        })?;
        Ok(Self {
            profile: profile.clone(),
            client,
            headers,
        })
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// Auth headers for the WebSocket handshake.
    pub fn auth_headers(&self) -> &[(String, String)] {
        &self.headers
    }

    pub fn marketstore_url(&self, path: &str) -> String {
        join(&self.profile.marketstore_url, path)
    }

    pub fn fatechan_url(&self, path: &str) -> String {
        join(&self.profile.fatechan_url, path)
    }
}

fn join(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Health {
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct HealthReport {
    pub marketstore: Health,
    pub fatechan: Health,
}

/// How long a health probe may take before it counts as down.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

async fn probe(client: &reqwest::Client, url: String) -> Health {
    match client.get(url).timeout(PROBE_TIMEOUT).send().await {
        Ok(r) if r.status().is_success() => Health::Up,
        _ => Health::Down,
    }
}

/// Probe both backends in parallel. Never fails: any error is `Down`.
pub async fn health(b: &Backend) -> HealthReport {
    let (marketstore, fatechan) = tokio::join!(
        probe(&b.client, b.marketstore_url("/v1/health")),
        probe(&b.client, b.fatechan_url("/health")),
    );
    HealthReport {
        marketstore,
        fatechan,
    }
}
