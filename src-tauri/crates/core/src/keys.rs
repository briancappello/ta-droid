//! Names of the entries the app keeps in its stores.

use crate::config::BrokerId;

/// Secret store: the provisioned fingerprint (credential-provisioning spec).
pub const FINGERPRINT: &str = "creds.fingerprint";

/// Secret store: one broker credential, JSON `{"key": .., "secret": ..}`.
pub fn credential(broker: BrokerId, account_id: &str) -> String {
    credential_raw(broker.as_str(), account_id)
}

/// Like [`credential`] for a broker name taken from the blob.
pub fn credential_raw(broker: &str, account_id: &str) -> String {
    format!("cred.{broker}:{account_id}")
}

/// Secret store: one auth header value for one backend profile.
pub fn backend_header(profile: &str, header: &str) -> String {
    format!("backend.{profile}.{}", header.to_ascii_lowercase())
}

/// Preferences: the active account id.
pub const ACTIVE_ACCOUNT: &str = "active.account";
/// Preferences: the active backend profile name.
pub const ACTIVE_PROFILE: &str = "active.profile";
