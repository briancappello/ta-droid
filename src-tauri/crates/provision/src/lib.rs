//! The encrypted credentials blob (credential-provisioning spec, design D6).
//!
//! Format, compatible with the libsodium blobs made by the old
//! `scripts/encrypt-credentials.mjs`:
//! - key: Argon2id v1.3, ops 3, memory 256 MiB, 32 bytes
//!   (libsodium `crypto_pwhash` MODERATE)
//! - cipher: XSalsa20-Poly1305 (`crypto_secretbox`), 24-byte nonce
//! - encoding: standard base64 with padding
//! - fingerprint: lowercase hex sha256 of the ciphertext's base64 text

use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use crypto_secretbox::aead::{Aead, KeyInit};
use crypto_secretbox::{Nonce, XSalsa20Poly1305};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use ta_core::config::EncryptedBlob;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

/// libsodium `crypto_pwhash_OPSLIMIT_MODERATE`.
pub const OPS_LIMIT: u32 = 3;
/// libsodium `crypto_pwhash_MEMLIMIT_MODERATE`, in KiB (256 MiB).
pub const MEM_LIMIT_KIB: u32 = 256 * 1024;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;

/// One broker credential.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Credential {
    pub broker: String,
    pub id: String,
    pub key: String,
    pub secret: String,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print key material, even in test failures.
        f.debug_struct("Credential")
            .field("broker", &self.broker)
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

/// The decrypted blob contents.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plaintext {
    #[serde(default)]
    pub credentials: Vec<Credential>,
    /// Profile name -> header name -> header value.
    #[serde(default)]
    pub backends: BTreeMap<String, BTreeMap<String, String>>,
}

impl Drop for Plaintext {
    fn drop(&mut self) {
        for headers in self.backends.values_mut() {
            for v in headers.values_mut() {
                v.zeroize();
            }
        }
    }
}

impl std::fmt::Debug for Plaintext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Plaintext")
            .field("credentials", &self.credentials)
            .field(
                "backends",
                &self
                    .backends
                    .iter()
                    .map(|(p, h)| (p, h.keys().collect::<Vec<_>>()))
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BlobError {
    /// Wrong passphrase, or a tampered blob: the authenticated cipher rejects
    /// both, and they are indistinguishable by design.
    #[error("the blob could not be decrypted")]
    Decrypt,
    #[error("the blob is malformed: {0}")]
    Malformed(&'static str),
    #[error("key derivation failed")]
    Kdf,
    #[error("no system randomness available")]
    Random,
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LEN]>, BlobError> {
    let params =
        Params::new(MEM_LIMIT_KIB, OPS_LIMIT, 1, Some(KEY_LEN)).map_err(|_| BlobError::Kdf)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| BlobError::Kdf)?;
    Ok(key)
}

/// sha256 hex of the base64 ciphertext text.
pub fn fingerprint(ciphertext_b64: &str) -> String {
    hex::encode(Sha256::digest(ciphertext_b64.as_bytes()))
}

/// Encrypt `plaintext` with a fresh random salt and nonce.
pub fn encrypt(passphrase: &str, plaintext: &Plaintext) -> Result<EncryptedBlob, BlobError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut salt).map_err(|_| BlobError::Random)?;
    getrandom::fill(&mut nonce).map_err(|_| BlobError::Random)?;
    let key = derive_key(passphrase, &salt)?;
    let body = Zeroizing::new(serde_json::to_vec(plaintext).expect("plaintext serializes"));
    let ct = XSalsa20Poly1305::new(key.as_ref().into())
        .encrypt(Nonce::from_slice(&nonce), body.as_slice())
        .map_err(|_| BlobError::Decrypt)?;
    let ciphertext = B64.encode(ct);
    Ok(EncryptedBlob {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        fingerprint: fingerprint(&ciphertext),
        ciphertext,
    })
}

/// Decrypt `blob`. Fails with [`BlobError::Decrypt`] on a wrong passphrase.
pub fn decrypt(passphrase: &str, blob: &EncryptedBlob) -> Result<Plaintext, BlobError> {
    let salt = B64
        .decode(&blob.salt)
        .map_err(|_| BlobError::Malformed("salt"))?;
    let nonce = B64
        .decode(&blob.nonce)
        .map_err(|_| BlobError::Malformed("nonce"))?;
    let ct = B64
        .decode(&blob.ciphertext)
        .map_err(|_| BlobError::Malformed("ciphertext"))?;
    if salt.len() != SALT_LEN {
        return Err(BlobError::Malformed("salt length"));
    }
    if nonce.len() != NONCE_LEN {
        return Err(BlobError::Malformed("nonce length"));
    }
    let key = derive_key(passphrase, &salt)?;
    let body = Zeroizing::new(
        XSalsa20Poly1305::new(key.as_ref().into())
            .decrypt(Nonce::from_slice(&nonce), ct.as_slice())
            .map_err(|_| BlobError::Decrypt)?,
    );
    serde_json::from_slice(&body).map_err(|_| BlobError::Malformed("plaintext"))
}
