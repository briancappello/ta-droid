//! fake-backends driven through the real ta-core clients, so both sides of
//! the contract are checked together.

use std::time::Duration;

use fake_backends::{ACCOUNTS, FakeState};
use serde_json::json;
use ta_core::accounts::Account;
use ta_core::broker::alpaca::Alpaca;
use ta_core::broker::{NewOrderRequest, OrderFilter, OrderSide, OrderType, TimeInForce};
use ta_core::config::{BrokerHosts, BrokerId, Profile};
use ta_core::profiles::{self, Backend, Health};
use ta_core::store::MemoryStore;
use ta_core::stream::{StreamClient, StreamConfig};
use ta_core::{marketstore as ms, techan, watchlists};

struct Fake {
    base: String,
    state: FakeState,
}

async fn start() -> Fake {
    ta_core::net::install_default_crypto_provider();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let state = FakeState::default();
    tokio::spawn(fake_backends::serve(listener, state.clone()));
    Fake { base, state }
}

impl Fake {
    fn backend(&self) -> Backend {
        let p = Profile {
            name: "e2e".into(),
            marketstore_url: format!("{}/marketstore", self.base),
            fatechan_url: format!("{}/fatechan", self.base),
            auth_headers: vec![],
            ca_cert_pem: None,
        };
        Backend::new(&p, &MemoryStore::default()).unwrap()
    }
    fn alpaca(&self, timeout: Duration) -> Alpaca {
        let url = format!("{}/alpaca", self.base);
        Alpaca::with_timeout(
            BrokerHosts {
                paper: url.clone(),
                live: url,
            },
            timeout,
        )
        .unwrap()
    }
    async fn fail(&self, rule: serde_json::Value) {
        let r = reqwest::Client::new()
            .post(format!("{}/__control/fail", self.base))
            .json(&rule)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 204);
    }
}

fn account(i: usize) -> Account {
    let a = ACCOUNTS[i];
    Account {
        broker: BrokerId::Alpaca,
        id: a.id.into(),
        name: a.id.into(),
        is_paper: i == 0,
        key: a.key.into(),
        secret: a.secret.into(),
    }
}

#[tokio::test]
async fn history_has_real_shape_for_every_timeframe() {
    let f = start().await;
    let b = f.backend();
    let h = ms::history(&b, "AAPL", "D", Some(1500)).await.unwrap();
    assert_eq!(h.index.len(), 1500);
    let s200 = h.columns.iter().position(|c| c == "sma200").unwrap();
    assert!(
        h.data.iter().all(|r| r[s200].is_some()),
        "warm across the window"
    );
    assert!(h.index.windows(2).all(|w| w[0] < w[1]), "ascending");
    for freq in [
        "1min", "2min", "5min", "10min", "15min", "30min", "h", "D", "W", "M",
    ] {
        let h = ms::history(&b, "AMD", freq, Some(50)).await.unwrap();
        assert_eq!(h.index.len(), 50, "{freq}");
    }
    // Intraday bars sit inside the 09:30-16:00 ET session (EDT, UTC-4).
    let h = ms::history(&b, "AMD", "5min", Some(200)).await.unwrap();
    for t in &h.index {
        let secs = (t / 1000).rem_euclid(86_400);
        assert!((13 * 3600 + 1800..20 * 3600).contains(&secs), "{t}");
    }
}

#[tokio::test]
async fn marketstore_errors_quotes_and_watchlists() {
    let f = start().await;
    let b = f.backend();
    assert_eq!(
        ms::history(&b, "NOPE", "D", None)
            .await
            .unwrap_err()
            .to_string(),
        "symbol not found"
    );
    assert!(
        ms::history(&b, "EMPTY", "D", None)
            .await
            .unwrap()
            .index
            .is_empty()
    );
    let q = ms::quotes(&b, &["AAPL".into(), "NEWIPO".into()])
        .await
        .unwrap();
    assert!(q[0].prev_close.is_some() && q[1].prev_close.is_none());
    let lists = watchlists::list(&b).await.unwrap();
    assert_eq!(
        lists.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(),
        ["Momentum", "Top Gainers", "Sector Aggregate"]
    );
    let rows = watchlists::entries(&b, "MOMENTUM").await.unwrap();
    assert!(
        rows.iter()
            .all(|r| r.price.is_some() && r.change_pct.is_some())
    );
    let agg = watchlists::entries(&b, "SECTOR_AGGREGATE").await.unwrap();
    assert_eq!(agg[0].agg_pct, Some(1.23));
}

#[tokio::test]
async fn stream_delivers_pushed_bars_and_watchlist_updates() {
    let f = start().await;
    let client = StreamClient::spawn(StreamConfig::for_backend(&f.backend()).unwrap());
    let mut bars = client.subscribe(vec!["AAPL/1Min/OHLCV".into()]);
    let mut wl = client.subscribe(vec![watchlists::stream_key("MOMENTUM")]);
    // Keep pushing until the subscription is live on the server side.
    let mut got = None;
    for _ in 0..50 {
        f.state.push(
            "AAPL/1Min/OHLCV",
            json!({"msg_type": "bar", "payload": {"close": 123.0, "epoch": 1}}),
        );
        f.state.push("WATCHLISTS/1Min/MOMENTUM", json!({"msg_type": "watchlist_update", "payload": {"symbols": [{"symbol": "X", "price": 1}]}}));
        if let Ok(Some(m)) = tokio::time::timeout(Duration::from_millis(100), bars.recv()).await {
            got = Some(m);
            break;
        }
    }
    assert_eq!(got.expect("a bar").data["payload"]["close"], 123.0);
    let w = tokio::time::timeout(Duration::from_secs(2), wl.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(w.data["msg_type"], "watchlist_update");
}

#[tokio::test]
async fn fatechan_strategies_tag_the_seeded_position_and_can_be_replaced() {
    let f = start().await;
    let b = f.backend();
    let t = techan::load_tagger(&b).await;
    assert_eq!(t.tag(&account(0), "AAPL"), "Momentum");
    assert_eq!(t.tag(&account(0), "MSFT"), "Unattributed");
    reqwest::Client::new()
        .post(format!("{}/__control/strategies", f.base))
        .json(&json!([{"broker_id":"alpaca","account_id":"PA1TEST","symbol":"MSFT","strategy":"MeanRev"}]))
        .send()
        .await
        .unwrap();
    assert_eq!(
        techan::load_tagger(&b).await.tag(&account(0), "MSFT"),
        "MeanRev"
    );
}

#[tokio::test]
async fn alpaca_serves_per_account_state_and_records_orders() {
    let f = start().await;
    let a = f.alpaca(Duration::from_secs(5));
    let pa = a.list_positions(&account(0)).await.unwrap();
    assert_eq!(
        pa.iter().map(|p| p.symbol.as_str()).collect::<Vec<_>>(),
        ["AAPL", "MSFT"]
    );
    assert_eq!(pa[1].side, "short");
    assert_eq!(a.list_positions(&account(1)).await.unwrap().len(), 1);
    assert_eq!(
        a.list_orders(&account(0), &OrderFilter::default())
            .await
            .unwrap()
            .len(),
        1
    );

    let req = NewOrderRequest {
        symbol: "AAPL".into(),
        side: OrderSide::Buy,
        order_type: OrderType::Limit,
        time_in_force: TimeInForce::Day,
        qty: Some("1".into()),
        notional: None,
        limit_price: Some("100".into()),
        stop_price: None,
        trail_percent: None,
        extended_hours: Some(false),
        client_order_id: Some("dup-test".into()),
    };
    a.create_order(&account(0), &req).await.unwrap();
    assert_eq!(
        a.list_orders(&account(0), &OrderFilter::default())
            .await
            .unwrap()
            .len(),
        2
    );
    let e = a.create_order(&account(0), &req).await.unwrap_err();
    assert_eq!(
        (e.status, e.message.as_str()),
        (422, "client_order_id must be unique")
    );

    let mut bad = account(0);
    bad.secret = "wrong".into();
    assert_eq!(
        a.list_positions(&bad).await.unwrap_err().message,
        "Check the API keys for this account."
    );
}

#[tokio::test]
async fn scripted_failures_cover_every_mode() {
    let f = start().await;
    let b = f.backend();
    let a = f.alpaca(Duration::from_millis(200));

    f.fail(json!({"target": "fatechan", "mode": "down"})).await;
    let h = profiles::health(&b).await;
    assert_eq!((h.marketstore, h.fatechan), (Health::Up, Health::Down));

    f.fail(json!({"target": "marketstore", "mode": "down", "times": 1}))
        .await;
    assert_eq!(profiles::health(&b).await.marketstore, Health::Down);
    assert_eq!(
        profiles::health(&b).await.marketstore,
        Health::Up,
        "times: 1 is consumed"
    );

    for (mode, want) in [
        ("401", "Check the API keys for this account."),
        ("429", "Rate limited by Alpaca, retry shortly."),
        ("422", "scripted rejection"),
        ("down", "Alpaca error (503)."),
        ("slow", "Alpaca request timed out."),
    ] {
        f.fail(json!({"target": "alpaca", "mode": mode, "times": 1, "slow_ms": 2000}))
            .await;
        assert_eq!(
            a.list_positions(&account(0)).await.unwrap_err().message,
            want,
            "{mode}"
        );
    }

    // Key-scoped and method-scoped rules only hit what they name.
    f.fail(json!({"target": "alpaca", "mode": "422", "key": ACCOUNTS[1].key, "method": "POST"}))
        .await;
    assert!(a.list_positions(&account(1)).await.is_ok());
    let req = NewOrderRequest {
        symbol: "AAPL".into(),
        side: OrderSide::Sell,
        order_type: OrderType::Market,
        time_in_force: TimeInForce::Day,
        qty: Some("1".into()),
        notional: None,
        limit_price: None,
        stop_price: None,
        trail_percent: None,
        extended_hours: None,
        client_order_id: None,
    };
    assert!(a.create_order(&account(0), &req).await.is_ok());
    assert!(a.create_order(&account(1), &req).await.is_err());

    // Reset clears rules and state.
    reqwest::Client::new()
        .post(format!("{}/__control/reset", f.base))
        .send()
        .await
        .unwrap();
    assert!(a.create_order(&account(1), &req).await.is_ok());
}
