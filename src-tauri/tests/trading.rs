//! Trading commands against the fake Alpaca and fa-techan.

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use ta_core::broker::validate::OrderForm;
use ta_core::broker::{OrderSide, OrderType, TimeInForce};
use ta_core::config::AppConfig;
use ta_core::store::MemoryStore;
use ta_droid_lib::state::AppState;
use ta_provision::flow::Outcome;

const PASS: &str = "e2e passphrase";

struct T {
    s: AppState,
    base: String,
}

async fn setup() -> T {
    ta_core::net::install_default_crypto_provider();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(fake_backends::serve(
        listener,
        fake_backends::FakeState::default(),
    ));
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../config/app-config.e2e.toml"
    ))
    .unwrap()
    .replace("http://127.0.0.1:8787", &base);
    let mut cfg = AppConfig::parse(&text).unwrap();
    let pt: ta_provision::Plaintext = serde_json::from_value(json!({"credentials": [
        {"broker":"alpaca","id":"PA1TEST","key":"PKTESTKEY0000001","secret":"test-secret-0001"},
        {"broker":"alpaca","id":"LV1TEST","key":"AKTESTKEY0000002","secret":"test-secret-0002"}]}))
    .unwrap();
    cfg.credentials_blob = Some(ta_provision::encrypt(PASS, &pt).unwrap());
    let s = AppState::new(
        cfg,
        Arc::new(MemoryStore::default()),
        Arc::new(MemoryStore::default()),
    )
    .unwrap();
    assert_eq!(s.provision(PASS.into()).await.unwrap(), Outcome::Ok);
    T { s, base }
}

impl T {
    async fn fail(&self, rule: serde_json::Value) {
        reqwest::Client::new()
            .post(format!("{}/__control/fail", self.base))
            .json(&rule)
            .send()
            .await
            .unwrap();
    }
    async fn posts(&self) -> Vec<serde_json::Value> {
        let log: Vec<fake_backends::LoggedRequest> =
            reqwest::get(format!("{}/__control/requests", self.base))
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
        log.into_iter()
            .filter(|r| r.method == "POST" && r.path == "/alpaca/v2/orders")
            .map(|r| serde_json::from_str(&r.body).unwrap())
            .collect()
    }
}

fn limit_form() -> OrderForm {
    OrderForm {
        symbol: " aapl ".into(),
        side: OrderSide::Buy,
        order_type: OrderType::Limit,
        time_in_force: TimeInForce::Day,
        qty: "2".into(),
        notional: String::new(),
        limit_price: "150".into(),
        stop_price: String::new(),
        trail_percent: String::new(),
        extended_hours: false,
        use_notional: false,
    }
}

#[tokio::test]
async fn positions_are_grouped_by_account_and_tagged_from_fatechan() {
    let t = setup().await;
    let book = t.s.positions().await;
    assert_eq!(
        book.iter()
            .map(|b| b.account.id.as_str())
            .collect::<Vec<_>>(),
        ["PA1TEST", "LV1TEST"]
    );
    let pa = &book[0];
    assert_eq!(
        pa.rows
            .iter()
            .map(|r| (r.item.symbol.as_str(), r.strategy.as_str()))
            .collect::<Vec<_>>(),
        [("AAPL", "Momentum"), ("MSFT", "Unattributed")]
    );
    assert_eq!(book[1].rows[0].strategy, "Unattributed");
    let json = serde_json::to_string(&book).unwrap();
    assert!(
        !json.contains("test-secret") && !json.contains("PKTESTKEY"),
        "{json}"
    );
}

#[tokio::test]
async fn a_failing_account_contributes_an_error_and_no_rows() {
    let t = setup().await;
    t.fail(json!({"target":"alpaca","mode":"401","key":"AKTESTKEY0000002"}))
        .await;
    let book = t.s.positions().await;
    assert_eq!(book[0].error, None);
    assert_eq!(
        book[1].error.as_deref(),
        Some("Check the API keys for this account.")
    );
    assert!(book[1].rows.is_empty());
}

#[tokio::test]
async fn fatechan_down_leaves_every_row_unattributed() {
    let t = setup().await;
    t.fail(json!({"target":"fatechan","mode":"down"})).await;
    assert!(
        t.s.positions()
            .await
            .iter()
            .flat_map(|b| &b.rows)
            .all(|r| r.strategy == "Unattributed")
    );
}

#[tokio::test]
async fn orders_are_open_only() {
    let t = setup().await;
    let book = t.s.orders().await;
    assert_eq!(book[0].rows.len(), 1);
    assert_eq!(book[0].rows[0].item.status, "new");
    t.s.place_order("PA1TEST", &limit_form()).await.unwrap();
    // Cancel the seeded order: it must drop out of the open list.
    t.s.live
        .read()
        .await
        .alpaca
        .cancel_order(&t.s.live.read().await.accounts[0], "seed-order-1")
        .await
        .unwrap();
    let book = t.s.orders().await;
    assert_eq!(
        book[0]
            .rows
            .iter()
            .map(|r| r.item.symbol.as_str())
            .collect::<Vec<_>>(),
        ["AAPL"]
    );
}

#[tokio::test]
async fn place_order_validates_again_and_sends_exactly_one_clean_request() {
    let t = setup().await;
    let bad = OrderForm {
        limit_price: String::new(),
        ..limit_form()
    };
    assert_eq!(
        t.s.place_order("PA1TEST", &bad).await.unwrap_err().message,
        "Limit price is required for limit orders."
    );
    assert_eq!(
        t.s.place_order("NOPE", &limit_form())
            .await
            .unwrap_err()
            .message,
        "Select an account."
    );
    assert!(t.posts().await.is_empty());

    let o = t.s.place_order("PA1TEST", &limit_form()).await.unwrap();
    assert_eq!(o.status, "accepted");
    let posts = t.posts().await;
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0]["symbol"], "AAPL");
    assert_eq!(posts[0]["limit_price"], "150");
    assert!(posts[0].get("stop_price").is_none());
    assert!(
        posts[0]["client_order_id"]
            .as_str()
            .unwrap()
            .starts_with("ta-")
    );
}

#[tokio::test]
async fn broker_errors_surface_as_the_spec_messages() {
    let t = setup().await;
    for (mode, want) in [
        ("401", "Check the API keys for this account."),
        ("429", "Rate limited by Alpaca, retry shortly."),
        ("422", "scripted rejection"),
    ] {
        t.fail(json!({"target":"alpaca","mode":mode,"method":"POST","times":1}))
            .await;
        assert_eq!(
            t.s.place_order("PA1TEST", &limit_form())
                .await
                .unwrap_err()
                .message,
            want,
            "{mode}"
        );
    }
    t.s.set_broker_timeout(Duration::from_millis(100)).await;
    t.fail(json!({"target":"alpaca","mode":"slow","slow_ms":2000,"times":1}))
        .await;
    assert_eq!(
        t.s.place_order("PA1TEST", &limit_form())
            .await
            .unwrap_err()
            .message,
        "Alpaca request timed out."
    );
}

#[tokio::test]
async fn flatten_plans_every_holder_and_retries_only_the_failed_leg() {
    let t = setup().await;
    let holdings = t.s.symbol_holdings("AAPL").await;
    assert_eq!(
        holdings
            .iter()
            .map(|h| (h.account_id.as_str(), h.qty.as_str()))
            .collect::<Vec<_>>(),
        [("PA1TEST", "10"), ("LV1TEST", "3")]
    );
    assert!(t.s.symbol_holdings("ZZZZ").await.is_empty());

    let legs = t.s.flatten_legs("AAPL").await;
    assert_eq!(legs.len(), 2);
    t.fail(
        json!({"target":"alpaca","mode":"422","key":"AKTESTKEY0000002","method":"POST","times":1}),
    )
    .await;
    let first = t.s.submit_flatten(legs).await;
    assert!(!first.all_ok);
    assert_eq!(first.remaining.len(), 1);
    assert_eq!(first.remaining[0].account_id, "LV1TEST");
    let second = t.s.submit_flatten(first.remaining).await;
    assert!(second.all_ok);
    assert_eq!(t.posts().await.len(), 3, "2 legs, then only the failed one");
}
