//! Ported from __tests__/techan.test.ts and strategyTagger.test.ts, plus the
//! enrichment-only failure modes.

use std::time::Duration;

use serde_json::json;
use ta_core::accounts::Account;
use ta_core::config::{BrokerId, Profile};
use ta_core::profiles::Backend;
use ta_core::store::MemoryStore;
use ta_core::techan::{self, StrategyPosition, Tagger};
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

fn backend(url: &str) -> Backend {
    let p = Profile {
        name: "t".into(),
        marketstore_url: url.into(),
        fatechan_url: url.into(),
        auth_headers: vec![],
        ca_cert_pem: None,
    };
    Backend::new(&p, &MemoryStore::default()).unwrap()
}

fn account(id: &str) -> Account {
    Account {
        broker: BrokerId::Alpaca,
        id: id.into(),
        name: id.into(),
        is_paper: false,
        key: "K".into(),
        secret: "S".into(),
    }
}

#[tokio::test]
async fn strategy_positions_returns_rows() {
    let server = MockServer::start().await;
    Mock::given(path("/strategies/positions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"broker_id":"alpaca","account_id":"a","symbol":"AAPL","strategy":"Momentum"}])))
        .mount(&server)
        .await;
    let rows = techan::strategy_positions(&backend(&server.uri())).await;
    assert_eq!(
        rows,
        [StrategyPosition {
            broker_id: "alpaca".into(),
            account_id: "a".into(),
            symbol: "AAPL".into(),
            strategy: "Momentum".into()
        }]
    );
}

#[tokio::test]
async fn every_failure_mode_gives_an_empty_list() {
    let server = MockServer::start().await;
    Mock::given(path("/500/strategies/positions"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    Mock::given(path("/bad/strategies/positions"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{not json"))
        .mount(&server)
        .await;
    Mock::given(path("/shape/strategies/positions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"rows": []})))
        .mount(&server)
        .await;
    Mock::given(path("/slow/strategies/positions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!([]))
                .set_delay(Duration::from_secs(30)),
        )
        .mount(&server)
        .await;
    for p in ["500", "bad", "shape"] {
        assert!(
            techan::strategy_positions(&backend(&format!("{}/{p}", server.uri())))
                .await
                .is_empty(),
            "{p}"
        );
    }
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let refused = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    assert!(
        techan::strategy_positions(&backend(&refused))
            .await
            .is_empty()
    );

    let slow = backend(&format!("{}/slow", server.uri()));
    assert!(
        techan::strategy_positions_within(&slow, Duration::from_millis(50))
            .await
            .is_empty(),
        "timeout"
    );
}

#[test]
fn tags_by_broker_account_and_symbol_case_sensitively() {
    let t = Tagger::new(&[StrategyPosition {
        broker_id: "alpaca".into(),
        account_id: "i".into(),
        symbol: "AAPL".into(),
        strategy: "Momentum".into(),
    }]);
    assert_eq!(t.tag(&account("i"), "AAPL"), "Momentum");
    assert_eq!(t.tag(&account("p"), "AAPL"), "Unattributed");
    assert_eq!(t.tag(&account("i"), "NVDA"), "Unattributed");
    assert_eq!(t.tag(&account("i"), "aapl"), "Unattributed");
    assert_eq!(Tagger::default().tag(&account("i"), "AAPL"), "Unattributed");
}
