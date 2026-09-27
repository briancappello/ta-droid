//! Build-time app configuration (design D8).
//!
//! The app crate embeds one TOML file at build time. It holds only non-secret
//! data: account metadata, backend profiles, broker host overrides, and the
//! encrypted credentials blob (ciphertext, safe to embed).

use serde::Deserialize;
use std::collections::BTreeMap;

/// A broker the app can trade through.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Deserialize,
    serde::Serialize,
    ts_rs::TS,
)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BrokerId {
    Alpaca,
}

impl BrokerId {
    pub fn as_str(self) -> &'static str {
        match self {
            BrokerId::Alpaca => "alpaca",
        }
    }
}

/// Non-secret account metadata. `id` is the broker's account number.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct AccountMeta {
    pub broker: BrokerId,
    pub id: String,
    pub name: String,
    pub is_paper: bool,
}

/// A named backend deployment (MarketStore + fa-techan).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Profile {
    pub name: String,
    pub marketstore_url: String,
    pub fatechan_url: String,
    /// Header names sent to both backends. Their values are provisioned
    /// secrets (credential-provisioning spec), never part of this file.
    #[serde(default)]
    pub auth_headers: Vec<String>,
    /// Extra trusted root CA, PEM, for a private-CA deployment.
    #[serde(default)]
    pub ca_cert_pem: Option<String>,
}

/// Base URLs for one broker's paper and live APIs.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BrokerHosts {
    pub paper: String,
    pub live: String,
}

/// The encrypted credentials blob (credential-provisioning spec).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, serde::Serialize)]
pub struct EncryptedBlob {
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub accounts: Vec<AccountMeta>,
    pub profiles: Vec<Profile>,
    pub brokers: BTreeMap<BrokerId, BrokerHosts>,
    pub credentials_blob: Option<EncryptedBlob>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("app config is not valid TOML: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("app config has an invalid `{field}`: {message}")]
    Field {
        field: &'static str,
        message: String,
    },
    #[error("app config defines no backend profiles")]
    NoProfiles,
    #[error("app config defines the profile `{0}` twice")]
    DuplicateProfile(String),
}

impl AppConfig {
    /// Parse the embedded config.
    ///
    /// Account metadata and the blob are lenient, like the React Native app:
    /// a malformed account list gives no accounts, and a malformed blob means
    /// nothing to provision. Profiles must be valid, because the app cannot
    /// reach any data without one.
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        let mut root: toml::Table = text.parse()?;

        let accounts = root
            .remove("accounts")
            .and_then(|v| v.try_into::<Vec<AccountMeta>>().ok())
            .unwrap_or_default();

        let credentials_blob = root
            .remove("credentials_blob")
            .and_then(|v| v.try_into::<EncryptedBlob>().ok());

        let profiles: Vec<Profile> = root
            .remove("profiles")
            .map(|v| v.try_into())
            .transpose()
            .map_err(|e: toml::de::Error| ConfigError::Field {
                field: "profiles",
                message: e.message().to_owned(),
            })?
            .unwrap_or_default();
        if profiles.is_empty() {
            return Err(ConfigError::NoProfiles);
        }
        for (i, p) in profiles.iter().enumerate() {
            if profiles[..i].iter().any(|q| q.name == p.name) {
                return Err(ConfigError::DuplicateProfile(p.name.clone()));
            }
        }

        let mut brokers = default_broker_hosts();
        if let Some(v) = root.remove("brokers") {
            let overrides: BTreeMap<BrokerId, BrokerHosts> =
                v.try_into()
                    .map_err(|e: toml::de::Error| ConfigError::Field {
                        field: "brokers",
                        message: e.message().to_owned(),
                    })?;
            brokers.extend(overrides);
        }

        Ok(Self {
            accounts,
            profiles,
            brokers,
            credentials_blob,
        })
    }

    pub fn profile(&self, name: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    pub fn broker_hosts(&self, broker: BrokerId) -> &BrokerHosts {
        self.brokers
            .get(&broker)
            .expect("every broker has default hosts")
    }
}

/// Production broker hosts; the config may override them (tests do).
pub fn default_broker_hosts() -> BTreeMap<BrokerId, BrokerHosts> {
    BTreeMap::from([(
        BrokerId::Alpaca,
        BrokerHosts {
            paper: "https://paper-api.alpaca.markets".into(),
            live: "https://api.alpaca.markets".into(),
        },
    )])
}
