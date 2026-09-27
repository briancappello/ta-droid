//! Ported from __tests__/provisioning.test.ts and the provisioning parts of
//! __tests__/accountContext.test.tsx.

use std::collections::BTreeMap;
use std::sync::Mutex;
use ta_core::config::EncryptedBlob;
use ta_core::keys;
use ta_core::store::{KvStore, MemoryStore, StoreError};
use ta_provision::flow::{Action, Outcome, action, run, run_with, stored_fingerprint};
use ta_provision::{BlobError, Credential, Plaintext};

fn blob(fp: &str) -> EncryptedBlob {
    EncryptedBlob {
        salt: "s".into(),
        nonce: "n".into(),
        ciphertext: "c".into(),
        fingerprint: fp.into(),
    }
}

fn plaintext() -> Plaintext {
    Plaintext {
        credentials: vec![Credential {
            broker: "alpaca".into(),
            id: "PA1".into(),
            key: "K".into(),
            secret: "S".into(),
        }],
        backends: BTreeMap::from([(
            "remote".into(),
            BTreeMap::from([("CF-Access-Client-Id".into(), "cid".into())]),
        )]),
    }
}

#[test]
fn fresh_install_provisions() {
    assert_eq!(action(Some(&blob("fp-new")), None), Action::Provision);
}

#[test]
fn changed_fingerprint_provisions() {
    assert_eq!(
        action(Some(&blob("fp-new")), Some("fp-old")),
        Action::Provision
    );
}

#[test]
fn unchanged_fingerprint_skips() {
    assert_eq!(action(Some(&blob("fp-new")), Some("fp-new")), Action::Skip);
}

#[test]
fn no_blob_skips() {
    assert_eq!(action(None, None), Action::Skip);
    assert_eq!(action(None, Some("fp-old")), Action::Skip);
}

#[test]
fn success_saves_creds_keyed_broker_id_and_backend_headers_then_the_fingerprint() {
    let store = MemoryStore::default();
    let out = run_with(&blob("fp-new"), "pass", &store, |_, _| Ok(plaintext()));
    assert_eq!(out, Outcome::Ok);
    let cred: serde_json::Value =
        serde_json::from_str(&store.get("cred.alpaca:PA1").unwrap().unwrap()).unwrap();
    assert_eq!(cred, serde_json::json!({"key": "K", "secret": "S"}));
    assert_eq!(
        store
            .get(&keys::backend_header("remote", "CF-Access-Client-Id"))
            .unwrap()
            .as_deref(),
        Some("cid")
    );
    assert_eq!(stored_fingerprint(&store).as_deref(), Some("fp-new"));
    assert_eq!(
        action(Some(&blob("fp-new")), stored_fingerprint(&store).as_deref()),
        Action::Skip
    );
}

#[test]
fn decrypt_failure_is_bad_passphrase_and_stores_nothing() {
    let store = MemoryStore::default();
    let out = run_with(&blob("fp-new"), "wrong", &store, |_, _| {
        Err(BlobError::Decrypt)
    });
    assert_eq!(out, Outcome::BadPassphrase);
    assert_eq!(stored_fingerprint(&store), None);
}

/// Fails every write whose key matches `fail_on`.
struct FailingStore {
    inner: MemoryStore,
    fail_on: &'static str,
    writes: Mutex<Vec<String>>,
}

impl KvStore for FailingStore {
    fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        self.inner.get(key)
    }
    fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.writes.lock().unwrap().push(key.into());
        if key.starts_with(self.fail_on) {
            return Err(StoreError::Backend("keychain write failed".into()));
        }
        self.inner.set(key, value)
    }
    fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.inner.delete(key)
    }
}

#[test]
fn save_failure_is_save_failed_and_leaves_no_fingerprint() {
    for fail_on in ["cred.", "backend."] {
        let store = FailingStore {
            inner: MemoryStore::default(),
            fail_on,
            writes: Mutex::default(),
        };
        let out = run_with(&blob("fp-new"), "pass", &store, |_, _| Ok(plaintext()));
        assert_eq!(out, Outcome::SaveFailed, "failing on {fail_on}");
        assert_eq!(stored_fingerprint(&store), None);
        assert!(
            !store
                .writes
                .lock()
                .unwrap()
                .iter()
                .any(|k| k == keys::FINGERPRINT)
        );
    }
}

#[test]
fn outcomes_serialize_as_a_bare_tag() {
    assert_eq!(
        serde_json::to_string(&Outcome::Ok).unwrap(),
        r#"{"outcome":"ok"}"#
    );
    assert_eq!(
        serde_json::to_string(&Outcome::BadPassphrase).unwrap(),
        r#"{"outcome":"bad-passphrase"}"#
    );
    assert_eq!(
        serde_json::to_string(&Outcome::SaveFailed).unwrap(),
        r#"{"outcome":"save-failed"}"#
    );
}

#[test]
fn real_crypto_end_to_end_with_the_node_fixture() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    let blob: EncryptedBlob =
        serde_json::from_str(&std::fs::read_to_string(format!("{dir}/node-blob.json")).unwrap())
            .unwrap();
    let pw = std::fs::read_to_string(format!("{dir}/node-passphrase.txt")).unwrap();
    let store = MemoryStore::default();
    assert_eq!(run(&blob, "wrong", &store), Outcome::BadPassphrase);
    assert_eq!(run(&blob, pw.trim_end(), &store), Outcome::Ok);
    assert!(store.get("cred.alpaca:LV1TEST").unwrap().is_some());
    assert_eq!(stored_fingerprint(&store), Some(blob.fingerprint));
}
