//! Market-data commands and live subscriptions against fake-backends.

use std::sync::Arc;
use std::time::Duration;

use fake_backends::FakeState;
use serde_json::json;
use ta_core::config::AppConfig;
use ta_core::store::MemoryStore;
use ta_droid_lib::state::AppState;
use tokio::sync::mpsc;

async fn setup() -> (AppState, FakeState, String) {
    ta_core::net::install_default_crypto_provider();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let fake = FakeState::default();
    tokio::spawn(fake_backends::serve(listener, fake.clone()));
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../config/app-config.e2e.toml"
    ))
    .unwrap()
    .replace("http://127.0.0.1:8787", &base);
    let s = AppState::new(
        AppConfig::parse(&text).unwrap(),
        Arc::new(MemoryStore::default()),
        Arc::new(MemoryStore::default()),
    )
    .unwrap();
    (s, fake, base)
}

/// Push until the forwarder delivers something (the socket connects lazily).
async fn push_until<T>(
    fake: &FakeState,
    key: &str,
    data: serde_json::Value,
    rx: &mut mpsc::UnboundedReceiver<T>,
) -> T {
    for _ in 0..100 {
        fake.push(key, data.clone());
        if let Ok(Some(v)) = tokio::time::timeout(Duration::from_millis(50), rx.recv()).await {
            return v;
        }
    }
    panic!("nothing delivered for {key}");
}

async fn wait_for_subscribe(fake: &FakeState, want: &[&str]) {
    for _ in 0..100 {
        if fake.ws_subscribes().await.last().is_some_and(|l| l == want) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!(
        "never saw subscribe {want:?}; got {:?}",
        fake.ws_subscribes().await
    );
}

#[tokio::test]
async fn data_commands_return_typed_results_and_user_facing_errors() {
    let (s, _fake, _) = setup().await;
    let h = s.history("AAPL", "D", Some(100)).await.unwrap();
    assert_eq!(h.index.len(), 100);
    assert_eq!(
        s.history("NOPE", "D", None).await.unwrap_err().message,
        "symbol not found"
    );
    assert_eq!(
        s.history("AAPL", "bogus", None).await.unwrap_err().message,
        "Unknown frequency: bogus"
    );
    assert_eq!(s.quotes(&["AAPL".into()]).await.unwrap().len(), 1);
    assert_eq!(s.watchlists().await.unwrap()[0].id, "MOMENTUM");
    assert_eq!(s.watchlist_entries("MOMENTUM").await.unwrap().len(), 4);
}

#[tokio::test]
async fn bar_and_watchlist_subscriptions_deliver_typed_messages() {
    let (s, fake, _) = setup().await;
    let (btx, mut brx) = mpsc::unbounded_channel();
    s.subscribe_bars("amd", "1Min", move |b| btx.send(b).is_ok())
        .await;
    let bar = push_until(
        &fake,
        "AMD/1Min/OHLCV",
        json!({"msg_type":"bar","payload":{"symbol":"AMD","open":1,"high":2,"low":0.5,"close":1.5,"volume":9,"epoch":1790366340}}),
        &mut brx,
    )
    .await;
    assert_eq!(bar.close, 1.5);

    let (wtx, mut wrx) = mpsc::unbounded_channel();
    s.subscribe_watchlist("MOMENTUM", move |r| wtx.send(r).is_ok())
        .await;
    let rows = push_until(
        &fake,
        "WATCHLISTS/1Min/MOMENTUM",
        json!({"msg_type":"watchlist_update","payload":{"symbols":[{"symbol":"X","price":2,"open":1,"prior_close":1}]}}),
        &mut wrx,
    )
    .await;
    assert_eq!(rows[0].change_pct, Some(100.0));
}

#[tokio::test]
async fn a_dropped_receiver_shrinks_the_subscribe_set_and_unsubscribe_is_idempotent() {
    let (s, fake, _) = setup().await;
    let (atx, mut arx) = mpsc::unbounded_channel();
    let (btx, brx) = mpsc::unbounded_channel();
    let a = s
        .subscribe_bars("AAPL", "1Min", move |b| atx.send(b).is_ok())
        .await;
    s.subscribe_bars("MSFT", "1Min", move |b| btx.send(b).is_ok())
        .await;
    push_until(&fake, "AAPL/1Min/OHLCV", json!({"msg_type":"bar","payload":{"open":1,"high":1,"low":1,"close":1,"volume":1,"epoch":1}}), &mut arx).await;
    wait_for_subscribe(&fake, &["AAPL/1Min/OHLCV", "MSFT/1Min/OHLCV"]).await;

    // The UI side of MSFT goes away: the next message ends that subscription.
    drop(brx);
    fake.push("MSFT/1Min/OHLCV", json!({"msg_type":"bar","payload":{"open":1,"high":1,"low":1,"close":1,"volume":1,"epoch":1}}));
    wait_for_subscribe(&fake, &["AAPL/1Min/OHLCV"]).await;
    assert_eq!(s.subscription_count(), 1);

    s.unsubscribe(a);
    s.unsubscribe(a);
    wait_for_subscribe(&fake, &[]).await;
    assert_eq!(s.subscription_count(), 0);
}

#[tokio::test]
async fn switching_profile_moves_open_subscriptions_to_the_new_stream() {
    let (s, fake, _) = setup().await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    s.subscribe_bars("AAPL", "1Min", move |b| tx.send(b).is_ok())
        .await;
    push_until(&fake, "AAPL/1Min/OHLCV", json!({"msg_type":"bar","payload":{"open":1,"high":1,"low":1,"close":1,"volume":1,"epoch":1}}), &mut rx).await;
    let before = fake.ws_subscribes().await.len();
    s.set_active_profile("e2e-auth").await.unwrap();
    // The new socket subscribes the same key and still delivers to the same sink.
    let b = push_until(&fake, "AAPL/1Min/OHLCV", json!({"msg_type":"bar","payload":{"open":2,"high":2,"low":2,"close":2,"volume":1,"epoch":2}}), &mut rx).await;
    assert_eq!(b.close, 2.0);
    assert!(fake.ws_subscribes().await.len() > before);
    assert_eq!(s.subscription_count(), 1);
}
