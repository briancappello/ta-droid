//! AppState (the command layer's backing logic) against fake-backends.

use std::sync::Arc;

use ta_core::config::AppConfig;
use ta_core::profiles::Health;
use ta_core::store::{KvStore, MemoryStore, SharedStore};
use ta_droid_lib::state::AppState;
use ta_provision::flow::Outcome;

const PASS: &str = "e2e passphrase";

async fn fake() -> String {
    ta_core::net::install_default_crypto_provider();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(fake_backends::serve(
        listener,
        fake_backends::FakeState::default(),
    ));
    base
}

/// The e2e config pointed at `base`, with a blob made for the test accounts.
fn config(base: &str) -> AppConfig {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../config/app-config.e2e.toml"
    ))
    .unwrap()
    .replace("http://127.0.0.1:8787", base);
    let mut cfg = AppConfig::parse(&text).unwrap();
    let pt: ta_provision::Plaintext = serde_json::from_value(serde_json::json!({
        "credentials": [
            {"broker":"alpaca","id":"PA1TEST","key":"PKTESTKEY0000001","secret":"test-secret-0001"},
            {"broker":"alpaca","id":"LV1TEST","key":"AKTESTKEY0000002","secret":"test-secret-0002"}
        ],
        "backends": {"e2e-auth": {"CF-Access-Client-Id": "cid", "CF-Access-Client-Secret": "csecret"}}
    }))
    .unwrap();
    cfg.credentials_blob = Some(ta_provision::encrypt(PASS, &pt).unwrap());
    cfg
}

fn stores() -> (SharedStore, SharedStore) {
    (
        Arc::new(MemoryStore::default()),
        Arc::new(MemoryStore::default()),
    )
}

#[tokio::test]
async fn provisioning_gates_then_loads_accounts_without_secrets() {
    let base = fake().await;
    let (secrets, prefs) = stores();
    let s = AppState::new(config(&base), secrets.clone(), prefs).unwrap();
    assert!(s.provisioning_status().needed);
    assert!(s.accounts().await.accounts.is_empty());

    assert_eq!(
        s.provision("wrong".into()).await.unwrap(),
        Outcome::BadPassphrase
    );
    assert!(s.provisioning_status().needed);

    assert_eq!(s.provision(PASS.into()).await.unwrap(), Outcome::Ok);
    assert!(!s.provisioning_status().needed);
    let v = s.accounts().await;
    assert_eq!(
        v.accounts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        ["PA1TEST", "LV1TEST"]
    );
    assert_eq!(v.active_id.as_deref(), Some("PA1TEST"));
    let json = serde_json::to_string(&v).unwrap();
    for secret in [
        "PKTESTKEY0000001",
        "test-secret-0001",
        "AKTESTKEY0000002",
        "test-secret-0002",
    ] {
        assert!(!json.contains(secret), "{secret} in {json}");
    }
    assert_eq!(v.accounts[0].key_last4, "0001");
}

#[tokio::test]
async fn save_failure_is_reported_and_keeps_the_prompt() {
    struct Failing;
    impl KvStore for Failing {
        fn get(&self, _: &str) -> Result<Option<String>, ta_core::store::StoreError> {
            Ok(None)
        }
        fn set(&self, _: &str, _: &str) -> Result<(), ta_core::store::StoreError> {
            Err(ta_core::store::StoreError::Unavailable("locked".into()))
        }
        fn delete(&self, _: &str) -> Result<(), ta_core::store::StoreError> {
            Ok(())
        }
    }
    let base = fake().await;
    let s = AppState::new(
        config(&base),
        Arc::new(Failing),
        Arc::new(MemoryStore::default()),
    )
    .unwrap();
    assert_eq!(s.provision(PASS.into()).await.unwrap(), Outcome::SaveFailed);
    assert!(s.provisioning_status().needed);
}

#[tokio::test]
async fn active_account_switches_and_rejects_unknown_ids() {
    let base = fake().await;
    let (secrets, prefs) = stores();
    let s = AppState::new(config(&base), secrets, prefs.clone()).unwrap();
    s.provision(PASS.into()).await.unwrap();
    assert_eq!(
        s.set_active_account("LV1TEST")
            .await
            .unwrap()
            .active_id
            .as_deref(),
        Some("LV1TEST")
    );
    assert!(s.set_active_account("NOPE").await.is_err());
    // A fresh state (next launch) keeps the choice.
    let again = AppState::new(config(&base), s.secrets.clone(), prefs).unwrap();
    assert_eq!(again.accounts().await.active_id.as_deref(), Some("LV1TEST"));
}

#[tokio::test]
async fn profiles_switch_persist_and_carry_provisioned_headers() {
    let base = fake().await;
    let (secrets, prefs) = stores();
    let s = AppState::new(config(&base), secrets.clone(), prefs.clone()).unwrap();
    let p = s.profiles().await;
    assert_eq!(p.active, "e2e");
    assert_eq!(
        p.profiles
            .iter()
            .map(|p| (p.name.as_str(), p.has_auth))
            .collect::<Vec<_>>(),
        [("e2e", false), ("e2e-auth", true)]
    );
    let h = s.health().await;
    assert_eq!((h.marketstore, h.fatechan), (Health::Up, Health::Up));

    s.provision(PASS.into()).await.unwrap();
    assert_eq!(
        s.set_active_profile("e2e-auth").await.unwrap().active,
        "e2e-auth"
    );
    assert!(s.set_active_profile("nope").await.is_err());
    s.health().await;
    let log: Vec<fake_backends::LoggedRequest> = reqwest::get(format!("{base}/__control/requests"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let last = log
        .iter()
        .rev()
        .find(|r| r.path == "/marketstore/v1/health")
        .unwrap();
    assert!(
        last.headers
            .iter()
            .any(|(k, v)| k == "cf-access-client-secret" && v == "csecret")
    );

    let again = AppState::new(config(&base), secrets, prefs).unwrap();
    assert_eq!(again.profiles().await.active, "e2e-auth");
    let json = serde_json::to_string(&again.profiles().await).unwrap();
    assert!(
        !json.contains("csecret") && !json.contains("cid\""),
        "{json}"
    );
}
