//! Ported from __tests__/accounts.test.ts and the active-account parts of
//! __tests__/accountContext.test.tsx.

use ta_core::accounts::{self, Account};
use ta_core::config::{AccountMeta, AppConfig, BrokerId};
use ta_core::keys;
use ta_core::store::{KvStore, MemoryStore, StoreError};

fn meta(id: &str, name: &str, is_paper: bool) -> AccountMeta {
    AccountMeta {
        broker: BrokerId::Alpaca,
        id: id.into(),
        name: name.into(),
        is_paper,
    }
}

fn secrets_with(creds: &[(&str, &str, &str)]) -> MemoryStore {
    let s = MemoryStore::default();
    for (id, key, secret) in creds {
        s.set(
            &keys::credential(BrokerId::Alpaca, id),
            &serde_json::json!({"key": key, "secret": secret}).to_string(),
        )
        .unwrap();
    }
    s
}

#[test]
fn joins_build_config_with_provisioned_creds() {
    let s = secrets_with(&[("PA1", "PKEY", "PSECRET")]);
    let loaded = accounts::load(&[meta("PA1", "Paper", true)], &s);
    assert_eq!(loaded.len(), 1);
    let a = &loaded[0];
    assert_eq!(
        (a.id.as_str(), a.name.as_str(), a.broker, a.is_paper),
        ("PA1", "Paper", BrokerId::Alpaca, true)
    );
    assert_eq!((a.key.as_str(), a.secret.as_str()), ("PKEY", "PSECRET"));
}

#[test]
fn accounts_without_a_provisioned_cred_are_skipped() {
    let s = secrets_with(&[("PA1", "PKEY", "PSECRET")]);
    s.set(&keys::credential(BrokerId::Alpaca, "BAD"), "not json")
        .unwrap();
    let loaded = accounts::load(
        &[
            meta("PA1", "Paper", true),
            meta("NOPE", "Unprovisioned", false),
            meta("BAD", "Corrupt", false),
        ],
        &s,
    );
    assert_eq!(
        loaded.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        ["PA1"]
    );
}

#[test]
fn malformed_account_metadata_yields_no_accounts() {
    let cfg = AppConfig::parse(
        "accounts = 'not a list'\n[[profiles]]\nname='p'\nmarketstore_url='m'\nfatechan_url='f'\n",
    )
    .unwrap();
    assert!(accounts::load(&cfg.accounts, &secrets_with(&[("PA1", "K", "S")])).is_empty());
}

fn two() -> Vec<Account> {
    let s = secrets_with(&[("a", "K", "S"), ("b", "K2", "S2")]);
    accounts::load(&[meta("a", "Paper", true), meta("b", "IRA", false)], &s)
}

#[test]
fn active_defaults_to_the_first_account() {
    assert_eq!(
        accounts::active_id(&two(), &MemoryStore::default()).as_deref(),
        Some("a")
    );
}

#[test]
fn set_active_switches_and_persists() {
    let prefs = MemoryStore::default();
    accounts::set_active_id(&prefs, "b");
    assert_eq!(accounts::active_id(&two(), &prefs).as_deref(), Some("b"));
}

#[test]
fn stale_active_id_falls_back_to_the_first_and_no_accounts_means_none() {
    let prefs = MemoryStore::default();
    accounts::set_active_id(&prefs, "gone");
    assert_eq!(accounts::active_id(&two(), &prefs).as_deref(), Some("a"));
    assert_eq!(accounts::active_id(&[], &prefs), None);
}

struct BrokenStore;
impl KvStore for BrokenStore {
    fn get(&self, _: &str) -> Result<Option<String>, StoreError> {
        Err(StoreError::Backend("down".into()))
    }
    fn set(&self, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Backend("down".into()))
    }
    fn delete(&self, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Backend("down".into()))
    }
}

#[test]
fn a_failed_active_write_is_ignored() {
    accounts::set_active_id(&BrokenStore, "b"); // must not panic or error
    assert_eq!(
        accounts::active_id(&two(), &BrokenStore).as_deref(),
        Some("a")
    );
}

#[test]
fn account_view_has_no_key_or_secret() {
    let s = secrets_with(&[("PA1", "PKTESTKEY0000001", "test-secret-0001")]);
    let a = &accounts::load(&[meta("PA1", "Paper", true)], &s)[0];
    let v = a.view();
    assert_eq!(v.key_last4, "0001");
    let json = serde_json::to_string(&v).unwrap();
    assert!(!json.contains("PKTESTKEY"), "{json}");
    assert!(!json.contains("test-secret"), "{json}");
    let keys: Vec<String> =
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&json)
            .unwrap()
            .keys()
            .cloned()
            .collect();
    assert_eq!(keys, ["broker", "id", "is_paper", "key_last4", "name"]);
    assert!(!format!("{a:?}").contains("PKTESTKEY"));
}
