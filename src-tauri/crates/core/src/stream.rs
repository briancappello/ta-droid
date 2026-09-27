//! MarketStore live stream (market-data spec, design D4).
//!
//! One shared WebSocket per backend, owned by a background task. Views
//! subscribe to stream keys and get a channel of messages; dropping the
//! [`Subscription`] unsubscribes (so it happens exactly once). Every change
//! sends the full union as `{"action":"subscribe","tbks":[...]}`, including
//! an empty union. The socket opens on the first subscription, reconnects
//! with backoff after any failure, and resends the union on reopen. Failures
//! never reach subscribers.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

/// One stream message for a key.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamMessage {
    pub key: String,
    pub data: serde_json::Value,
}

/// `http(s)://host/base` -> `ws(s)://host/base/ws`.
pub fn ws_url(marketstore_url: &str) -> String {
    let base = marketstore_url.trim_end_matches('/');
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base.to_owned()
    };
    format!("{ws}/ws")
}

/// `min(1000 · 2^attempt, 15000)` ms.
pub fn default_backoff(attempt: u32) -> Duration {
    Duration::from_millis(1000u64.saturating_mul(1u64 << attempt.min(20)).min(15_000))
}

impl StreamConfig {
    /// The stream for a backend profile: its URL, auth headers, and TLS.
    pub fn for_backend(b: &crate::profiles::Backend) -> Result<Self, crate::net::NetError> {
        Ok(Self {
            url: ws_url(&b.profile.marketstore_url),
            headers: b.auth_headers().to_vec(),
            tls: Some(crate::net::ws_tls_config(b.profile.ca_cert_pem.as_deref())?),
            backoff: default_backoff,
        })
    }
}

pub struct StreamConfig {
    pub url: String,
    /// Sent on the handshake (profile auth headers).
    pub headers: Vec<(String, String)>,
    /// TLS for `wss://` (the profile's roots and CA).
    pub tls: Option<rustls::ClientConfig>,
    pub backoff: fn(u32) -> Duration,
}

enum Cmd {
    Subscribe {
        id: u64,
        tbks: Vec<String>,
        tx: mpsc::UnboundedSender<StreamMessage>,
    },
    Unsubscribe {
        id: u64,
    },
}

/// Handle to the shared stream. Cheap to clone. The socket closes when the
/// last handle and subscription are gone.
#[derive(Clone)]
pub struct StreamClient {
    cmd: mpsc::UnboundedSender<Cmd>,
    next_id: Arc<std::sync::atomic::AtomicU64>,
}

/// Messages for one subscription. Dropping it unsubscribes.
pub struct Subscription {
    pub rx: mpsc::UnboundedReceiver<StreamMessage>,
    id: u64,
    cmd: mpsc::UnboundedSender<Cmd>,
}

impl Subscription {
    pub async fn recv(&mut self) -> Option<StreamMessage> {
        self.rx.recv().await
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.cmd.send(Cmd::Unsubscribe { id: self.id });
    }
}

impl StreamClient {
    /// Start the background task on the current Tokio runtime. It stays idle
    /// until the first subscription.
    pub fn spawn(cfg: StreamConfig) -> Self {
        let (cmd, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(cfg, rx));
        Self {
            cmd,
            next_id: Arc::default(),
        }
    }

    pub fn subscribe(&self, tbks: Vec<String>) -> Subscription {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (tx, rx) = mpsc::unbounded_channel();
        let _ = self.cmd.send(Cmd::Subscribe { id, tbks, tx });
        Subscription {
            rx,
            id,
            cmd: self.cmd.clone(),
        }
    }
}

#[derive(Default)]
struct State {
    subs: HashMap<u64, (Vec<String>, mpsc::UnboundedSender<StreamMessage>)>,
    counts: BTreeMap<String, usize>,
}

impl State {
    fn apply(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Subscribe { id, tbks, tx } => {
                for t in &tbks {
                    *self.counts.entry(t.clone()).or_default() += 1;
                }
                self.subs.insert(id, (tbks, tx));
            }
            Cmd::Unsubscribe { id } => {
                if let Some((tbks, _)) = self.subs.remove(&id) {
                    for t in tbks {
                        if let Some(n) = self.counts.get_mut(&t) {
                            *n -= 1;
                            if *n == 0 {
                                self.counts.remove(&t);
                            }
                        }
                    }
                }
            }
        }
    }

    fn union_message(&self) -> Message {
        let tbks: Vec<&String> = self.counts.keys().collect();
        Message::text(serde_json::json!({ "action": "subscribe", "tbks": tbks }).to_string())
    }

    fn dispatch(&mut self, text: &str) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        // Acks and error envelopes carry `action`; data messages carry `key`.
        if v.get("action").is_some() {
            return;
        }
        let Ok(m) = serde_json::from_value::<StreamMessage>(v) else {
            return;
        };
        for (tbks, tx) in self.subs.values() {
            if tbks.contains(&m.key) {
                let _ = tx.send(m.clone());
            }
        }
    }
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(cfg: &StreamConfig) -> Option<Ws> {
    let mut req = cfg.url.as_str().into_client_request().ok()?;
    let h = req.headers_mut();
    h.insert("Sec-WebSocket-Protocol", HeaderValue::from_static("json"));
    for (name, value) in &cfg.headers {
        let name =
            tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes()).ok()?;
        let mut value = HeaderValue::from_str(value).ok()?;
        value.set_sensitive(true);
        h.insert(name, value);
    }
    let connector = cfg
        .tls
        .clone()
        .map(|t| tokio_tungstenite::Connector::Rustls(Arc::new(t)));
    let (ws, _) = tokio_tungstenite::connect_async_tls_with_config(req, None, false, connector)
        .await
        .ok()?;
    Some(ws)
}

/// Sleep for the next backoff step while still applying commands. Returns
/// false when every handle is gone.
async fn backoff_wait(
    cfg: &StreamConfig,
    attempt: &mut u32,
    st: &mut State,
    cmds: &mut mpsc::UnboundedReceiver<Cmd>,
) -> bool {
    let sleep = tokio::time::sleep((cfg.backoff)(*attempt));
    *attempt = attempt.saturating_add(1);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return true,
            c = cmds.recv() => match c {
                Some(c) => st.apply(c),
                None => return false,
            },
        }
    }
}

async fn run(cfg: StreamConfig, mut cmds: mpsc::UnboundedReceiver<Cmd>) {
    let mut st = State::default();
    let mut attempt: u32 = 0;
    loop {
        // Idle until someone subscribes.
        while st.counts.is_empty() {
            match cmds.recv().await {
                Some(c) => st.apply(c),
                None => return,
            }
        }
        let Some(mut ws) = connect(&cfg).await else {
            if !backoff_wait(&cfg, &mut attempt, &mut st, &mut cmds).await {
                return;
            }
            continue;
        };
        attempt = 0;
        if ws.send(st.union_message()).await.is_err() {
            continue;
        }
        let dropped = loop {
            tokio::select! {
                c = cmds.recv() => match c {
                    Some(c) => {
                        st.apply(c);
                        if ws.send(st.union_message()).await.is_err() {
                            break true;
                        }
                    }
                    None => {
                        let _ = ws.close(None).await;
                        return;
                    }
                },
                m = ws.next() => match m {
                    Some(Ok(Message::Text(t))) => st.dispatch(t.as_str()),
                    Some(Ok(Message::Binary(b))) => {
                        if let Ok(t) = std::str::from_utf8(&b) {
                            st.dispatch(t);
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break true,
                },
            }
        };
        if dropped && !backoff_wait(&cfg, &mut attempt, &mut st, &mut cmds).await {
            return;
        }
    }
}

/// A live bar (`msg_type: "bar"`). `epoch` is the period start, unix seconds.
#[derive(ts_rs::TS)]
#[ts(export)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveBar {
    #[serde(default)]
    pub symbol: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    #[ts(type = "number")]
    pub epoch: i64,
}

/// The chart's stream key for a symbol and MarketStore timeframe.
pub fn bar_key(symbol: &str, timeframe: &str) -> String {
    format!("{}/{timeframe}/OHLCV", symbol.to_uppercase())
}

/// A `bar` message's payload, or None for anything else.
pub fn as_bar(m: &StreamMessage) -> Option<LiveBar> {
    if m.data.get("msg_type")?.as_str()? != "bar" {
        return None;
    }
    serde_json::from_value(m.data.get("payload")?.clone()).ok()
}

/// A `watchlist_update` message as display rows, or None for anything else.
pub fn as_watchlist_rows(m: &StreamMessage) -> Option<Vec<crate::watchlists::WatchRow>> {
    if m.data.get("msg_type")?.as_str()? != "watchlist_update" {
        return None;
    }
    let symbols = m.data.get("payload")?.get("symbols")?.as_array()?;
    Some(
        symbols
            .iter()
            .filter_map(|s| s.as_object().map(crate::watchlists::to_row))
            .collect(),
    )
}
