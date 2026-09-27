//! Provisioning flow: decide whether to ask for the passphrase, then decrypt
//! and store every secret, storing the fingerprint last.

use crate::{BlobError, Plaintext};
use serde::Serialize;
use ta_core::config::EncryptedBlob;
use ta_core::keys;
use ta_core::store::KvStore;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    Skip,
    Provision,
}

/// Provision when a blob ships and its fingerprint is not the stored one.
/// The app version plays no part.
pub fn action(shipped: Option<&EncryptedBlob>, stored_fingerprint: Option<&str>) -> Action {
    match shipped {
        None => Action::Skip,
        Some(b) if stored_fingerprint == Some(b.fingerprint.as_str()) => Action::Skip,
        Some(_) => Action::Provision,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "outcome")]
pub enum Outcome {
    Ok,
    /// Decryption failed: wrong passphrase (or a damaged blob).
    BadPassphrase,
    /// A secret-store write failed; the fingerprint was not stored, so the
    /// prompt returns at the next launch.
    SaveFailed,
}

/// Read the stored fingerprint; an unreadable store counts as none.
pub fn stored_fingerprint(secrets: &dyn KvStore) -> Option<String> {
    secrets.get(keys::FINGERPRINT).ok().flatten()
}

/// Decrypt `blob` and store its contents. Never logs or returns a secret.
pub fn run(blob: &EncryptedBlob, passphrase: &str, secrets: &dyn KvStore) -> Outcome {
    run_with(blob, passphrase, secrets, crate::decrypt)
}

/// [`run`] with the decrypt step injected, for tests.
pub fn run_with(
    blob: &EncryptedBlob,
    passphrase: &str,
    secrets: &dyn KvStore,
    decrypt: impl FnOnce(&str, &EncryptedBlob) -> Result<Plaintext, BlobError>,
) -> Outcome {
    let Ok(pt) = decrypt(passphrase, blob) else {
        return Outcome::BadPassphrase;
    };
    match save(&pt, secrets).and_then(|()| secrets.set(keys::FINGERPRINT, &blob.fingerprint)) {
        Ok(()) => Outcome::Ok,
        Err(_) => Outcome::SaveFailed,
    }
}

fn save(pt: &Plaintext, secrets: &dyn KvStore) -> Result<(), ta_core::store::StoreError> {
    for c in &pt.credentials {
        let value =
            Zeroizing::new(serde_json::json!({ "key": c.key, "secret": c.secret }).to_string());
        secrets.set(&keys::credential_raw(&c.broker, &c.id), &value)?;
    }
    for (profile, headers) in &pt.backends {
        for (name, value) in headers {
            secrets.set(&keys::backend_header(profile, name), value)?;
        }
    }
    Ok(())
}
