//! Ported from __tests__/marketstoreStream.test.ts, against an in-process
//! WebSocket server, plus handshake headers.

use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use ta_core::stream::{StreamClient, StreamConfig, default_backoff, ws_url};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

/// What the fake server sees: one event per connection or message.
#[derive(Debug)]
enum Seen {
    Connected {
        protocol: Option<String>,
        auth: Option<String>,
    },
    Subscribe(Vec<String>),
}

/// Test-side handle to push frames to the current connection or drop it.
enum Ctl {
    Send(String),
    Drop,
}

struct Server {
    addr: std::net::SocketAddr,
    seen: mpsc::UnboundedReceiver<Seen>,
    ctl: mpsc::UnboundedSender<Ctl>,
}

async fn server_on(listener: TcpListener) -> Server {
    let addr = listener.local_addr().unwrap();
    let (seen_tx, seen) = mpsc::unbounded_channel();
    let (ctl, mut ctl_rx) = mpsc::unbounded_channel::<Ctl>();
    tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let (mut proto, mut auth) = (None, None);
            let cb = |req: &Request, mut res: Response| {
                proto = req
                    .headers()
                    .get("sec-websocket-protocol")
                    .map(|v| v.to_str().unwrap().to_owned());
                auth = req
                    .headers()
                    .get("cf-access-client-id")
                    .map(|v| v.to_str().unwrap().to_owned());
                res.headers_mut()
                    .insert("sec-websocket-protocol", "json".parse().unwrap());
                Ok(res)
            };
            let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(tcp, cb).await else {
                continue;
            };
            seen_tx
                .send(Seen::Connected {
                    protocol: proto,
                    auth,
                })
                .unwrap();
            loop {
                tokio::select! {
                    m = ws.next() => match m {
                        Some(Ok(Message::Text(t))) => {
                            let v: Value = serde_json::from_str(t.as_str()).unwrap();
                            assert_eq!(v["action"], "subscribe");
                            let tbks = v["tbks"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_owned()).collect();
                            seen_tx.send(Seen::Subscribe(tbks)).unwrap();
                        }
                        Some(Ok(_)) => {}
                        _ => break,
                    },
                    c = ctl_rx.recv() => match c {
                        Some(Ctl::Send(t)) => { ws.send(Message::text(t)).await.unwrap(); }
                        Some(Ctl::Drop) | None => break,
                    },
                }
            }
        }
    });
    Server { addr, seen, ctl }
}

async fn server() -> Server {
    server_on(TcpListener::bind("127.0.0.1:0").await.unwrap()).await
}

fn fast(_: u32) -> Duration {
    Duration::from_millis(20)
}

fn client(addr: std::net::SocketAddr, headers: Vec<(String, String)>) -> StreamClient {
    StreamClient::spawn(StreamConfig {
        url: format!("ws://{addr}/ws"),
        headers,
        tls: None,
        backoff: fast,
    })
}

async fn next(s: &mut Server) -> Seen {
    timeout(Duration::from_secs(5), s.seen.recv())
        .await
        .expect("server event")
        .unwrap()
}

async fn next_sub(s: &mut Server) -> Vec<String> {
    loop {
        if let Seen::Subscribe(t) = next(s).await {
            return t;
        }
    }
}

#[test]
fn ws_url_converts_http_to_ws_and_appends_ws() {
    assert_eq!(ws_url("https://ms.test"), "wss://ms.test/ws");
    assert_eq!(
        ws_url("http://127.0.0.1:8787/marketstore/"),
        "ws://127.0.0.1:8787/marketstore/ws"
    );
}

#[test]
fn default_backoff_doubles_and_caps_at_15s() {
    let ms: Vec<u128> = (0..6).map(|a| default_backoff(a).as_millis()).collect();
    assert_eq!(ms, [1000, 2000, 4000, 8000, 15000, 15000]);
    assert_eq!(default_backoff(60).as_millis(), 15000);
}

#[tokio::test]
async fn subscribe_opens_a_json_socket_with_profile_headers_and_sends_the_union() {
    let mut s = server().await;
    let c = client(s.addr, vec![("CF-Access-Client-Id".into(), "cid".into())]);
    let _sub = c.subscribe(vec!["WATCHLISTS/1Min/MOMENTUM".into()]);
    match next(&mut s).await {
        Seen::Connected { protocol, auth } => {
            assert_eq!(protocol.as_deref(), Some("json"));
            assert_eq!(auth.as_deref(), Some("cid"));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(next_sub(&mut s).await, ["WATCHLISTS/1Min/MOMENTUM"]);
}

#[tokio::test]
async fn dispatches_payloads_by_key_and_drops_acks_and_malformed() {
    let mut s = server().await;
    let c = client(s.addr, vec![]);
    let mut a = c.subscribe(vec!["AAPL/1Min/OHLCV".into()]);
    let mut b = c.subscribe(vec!["MSFT/1Min/OHLCV".into()]);
    next_sub(&mut s).await;
    for f in [
        json!({"action":"subscribed","tbks":["AAPL/1Min/OHLCV"]}).to_string(),
        "not json".into(),
        json!({"data":{"msg_type":"bar"}}).to_string(),
        json!({"key":"AAPL/1Min/OHLCV","data":{"msg_type":"bar","payload":{"close":5}}})
            .to_string(),
    ] {
        s.ctl.send(Ctl::Send(f)).unwrap();
    }
    let m = timeout(Duration::from_secs(5), a.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(m.data["payload"]["close"], 5);
    assert!(
        timeout(Duration::from_millis(200), a.recv()).await.is_err(),
        "only one message for AAPL"
    );
    assert!(
        timeout(Duration::from_millis(100), b.recv()).await.is_err(),
        "nothing for MSFT"
    );
}

#[tokio::test]
async fn a_second_subscriber_extends_the_union_and_unsubscribe_removes() {
    let mut s = server().await;
    let c = client(s.addr, vec![]);
    let a = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
    let b = c.subscribe(vec!["B/1Min/OHLCV".into()]);
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV", "B/1Min/OHLCV"]);
    drop(a);
    assert_eq!(next_sub(&mut s).await, ["B/1Min/OHLCV"]);
    drop(b);
    assert!(next_sub(&mut s).await.is_empty());
}

#[tokio::test]
async fn one_subscriber_leaving_does_not_remove_a_shared_key() {
    let mut s = server().await;
    let c = client(s.addr, vec![]);
    let one = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    next_sub(&mut s).await;
    let two = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
    drop(one); // Drop runs once: unsubscribing is idempotent by construction.
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
    drop(two);
    assert!(next_sub(&mut s).await.is_empty());
}

#[tokio::test]
async fn a_failed_connection_retries_with_backoff_without_surfacing_an_error() {
    // Reserve a port, leave nothing listening, then start the server later.
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = probe.local_addr().unwrap();
    drop(probe);
    let c = client(addr, vec![]);
    let mut sub = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    tokio::time::sleep(Duration::from_millis(100)).await; // several refused attempts
    assert!(
        sub.rx.try_recv().is_err(),
        "no error delivered to the subscriber"
    );
    let mut s = server_on(TcpListener::bind(addr).await.unwrap()).await;
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
}

#[tokio::test]
async fn reconnects_after_a_drop_and_resubscribes_the_union() {
    let mut s = server().await;
    let c = client(s.addr, vec![]);
    let _a = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
    s.ctl.send(Ctl::Drop).unwrap();
    assert!(matches!(next(&mut s).await, Seen::Connected { .. }));
    assert_eq!(next_sub(&mut s).await, ["A/1Min/OHLCV"]);
}

#[tokio::test]
async fn no_socket_until_the_first_subscription() {
    let mut s = server().await;
    let c = client(s.addr, vec![]);
    assert!(
        timeout(Duration::from_millis(200), s.seen.recv())
            .await
            .is_err()
    );
    let _a = c.subscribe(vec!["A/1Min/OHLCV".into()]);
    assert!(matches!(next(&mut s).await, Seen::Connected { .. }));
}
