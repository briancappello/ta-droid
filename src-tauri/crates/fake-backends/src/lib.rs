//! Test double for the three backends the app talks to.
//!
//! One HTTP listener serves everything under a prefix, so a single
//! `adb reverse` or `ssh -R` tunnel exposes all of it to a device:
//!
//! - `/marketstore/...` — MarketStore REST and `/marketstore/ws`
//! - `/fatechan/...`    — fa-techan
//! - `/alpaca/...`      — Alpaca trading API (paper and live share it)
//! - `/__control/...`   — test control: request log, reset, scripted
//!   failures, WS pushes, fa-techan strategy rows
//!
//! Every request to a backend prefix is recorded, including headers, so
//! tests can assert what the app sent (and that no secret went where it
//! must not). Data is deterministic: see `fixtures`.

mod fixtures;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};

pub use fixtures::{ACCOUNTS, FakeAccount};

/// One recorded request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoggedRequest {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: Vec<(String, String)>,
    /// Request body as text (JSON bodies for Alpaca orders).
    #[serde(default)]
    pub body: String,
}

/// Which backend a scripted failure applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Marketstore,
    Fatechan,
    Alpaca,
}

/// A scripted failure mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 503 on everything (health reads as down).
    Down,
    #[serde(rename = "401")]
    Unauthorized,
    #[serde(rename = "429")]
    RateLimited,
    #[serde(rename = "422")]
    Unprocessable,
    /// Answer after `slow_ms` (default 60 s), to trigger client timeouts.
    Slow,
}

/// `POST /__control/fail` body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailRule {
    pub target: Target,
    pub mode: Mode,
    /// Alpaca only: fail just this API key id.
    #[serde(default)]
    pub key: Option<String>,
    /// Alpaca only: fail just this method (e.g. "POST").
    #[serde(default)]
    pub method: Option<String>,
    /// Fail this many matching requests, then pass. None: until reset.
    #[serde(default)]
    pub times: Option<u32>,
    #[serde(default)]
    pub slow_ms: Option<u64>,
}

#[derive(Default)]
struct Inner {
    requests: Vec<LoggedRequest>,
    rules: Vec<FailRule>,
    /// Alpaca state per API key id.
    positions: HashMap<String, Vec<Value>>,
    orders: HashMap<String, Vec<Value>>,
    strategies: Vec<Value>,
    next_order: u64,
}

impl Inner {
    fn seeded() -> Self {
        let mut s = Self::default();
        for a in &ACCOUNTS {
            s.positions.insert(a.key.into(), fixtures::positions(a));
            s.orders.insert(a.key.into(), fixtures::open_orders(a));
        }
        s.strategies = fixtures::strategies();
        s
    }
}

/// Shared server state.
#[derive(Clone)]
pub struct FakeState {
    inner: Arc<Mutex<Inner>>,
    log_path: Option<Arc<PathBuf>>,
    ws: broadcast::Sender<(String, Value)>,
}

impl Default for FakeState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::seeded())),
            log_path: None,
            ws: broadcast::channel(256).0,
        }
    }
}

impl FakeState {
    /// State that also appends each request as a JSON line to `path`.
    pub fn with_log_file(path: PathBuf) -> Self {
        Self {
            log_path: Some(Arc::new(path)),
            ..Self::default()
        }
    }

    /// A snapshot of every recorded request, oldest first.
    pub async fn requests(&self) -> Vec<LoggedRequest> {
        self.inner.lock().await.requests.clone()
    }

    /// Push a stream message to every socket subscribed to `key`.
    pub fn push(&self, key: &str, data: Value) {
        let _ = self.ws.send((key.to_owned(), data));
    }

    async fn record(&self, entry: LoggedRequest) {
        if let Some(path) = &self.log_path {
            let mut line = serde_json::to_vec(&entry).expect("log entry serializes");
            line.push(b'\n');
            // A log write failure must not change the response under test.
            if let Ok(mut f) = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path.as_ref())
                .await
            {
                let _ = f.write_all(&line).await;
            }
        }
        self.inner.lock().await.requests.push(entry);
    }

    /// The failure to apply to this request, consuming one use.
    async fn take_failure(
        &self,
        target: Target,
        method: &str,
        key: Option<&str>,
    ) -> Option<FailRule> {
        let mut inner = self.inner.lock().await;
        let i = inner.rules.iter().position(|r| {
            r.target == target
                && r.key.as_deref().is_none_or(|k| Some(k) == key)
                && r.method
                    .as_deref()
                    .is_none_or(|m| m.eq_ignore_ascii_case(method))
        })?;
        let rule = inner.rules[i].clone();
        if let Some(n) = inner.rules[i].times.as_mut() {
            *n -= 1;
            if *n == 0 {
                inner.rules.remove(i);
            }
        }
        Some(rule)
    }
}

const BODY_LIMIT: usize = 1 << 20;

async fn record_and_fail(State(state): State<FakeState>, req: Request, next: Next) -> Response {
    let (parts, body) = req.into_parts();
    let path = parts.uri.path().to_owned();
    let bytes = axum::body::to_bytes(body, BODY_LIMIT)
        .await
        .unwrap_or_default();
    if path.starts_with("/__control") {
        return next
            .run(Request::from_parts(parts, Body::from(bytes)))
            .await;
    }
    let headers: Vec<(String, String)> = parts
        .headers
        .iter()
        .map(|(k, v)| {
            (
                k.to_string(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();
    state
        .record(LoggedRequest {
            method: parts.method.to_string(),
            path: path.clone(),
            query: parts.uri.query().map(str::to_owned),
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
        .await;

    let target = if path.starts_with("/marketstore") {
        Some(Target::Marketstore)
    } else if path.starts_with("/fatechan") {
        Some(Target::Fatechan)
    } else if path.starts_with("/alpaca") {
        Some(Target::Alpaca)
    } else {
        None
    };
    if let Some(t) = target {
        let key = parts
            .headers
            .get("apca-api-key-id")
            .and_then(|v| v.to_str().ok());
        if let Some(rule) = state.take_failure(t, parts.method.as_str(), key).await {
            match rule.mode {
                Mode::Down => return (StatusCode::SERVICE_UNAVAILABLE, "down").into_response(),
                Mode::Unauthorized => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({"message": "unauthorized"})),
                    )
                        .into_response();
                }
                Mode::RateLimited => {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(json!({"message": "too many"})),
                    )
                        .into_response();
                }
                Mode::Unprocessable => {
                    return (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        Json(
                            json!({"message": "scripted rejection", "error": "scripted rejection"}),
                        ),
                    )
                        .into_response();
                }
                Mode::Slow => {
                    tokio::time::sleep(Duration::from_millis(rule.slow_ms.unwrap_or(60_000))).await
                }
            }
        }
    }
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

// ---- MarketStore ----------------------------------------------------------

#[derive(Deserialize)]
struct BarsQuery {
    timeframe: String,
    limit: Option<usize>,
}

async fn ms_bars(Path(symbol): Path<String>, Query(q): Query<BarsQuery>) -> Response {
    if symbol == "NOPE" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "symbol not found"})),
        )
            .into_response();
    }
    if symbol == "EMPTY" {
        return Json(json!({"symbol": symbol, "timeframe": q.timeframe, "bars": []}))
            .into_response();
    }
    let Some(bars) = fixtures::bars(&symbol, &q.timeframe, q.limit.unwrap_or(500)) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "bad timeframe"})),
        )
            .into_response();
    };
    Json(json!({"symbol": symbol, "timeframe": q.timeframe, "bars": bars})).into_response()
}

#[derive(Deserialize)]
struct QuotesQuery {
    symbols: String,
}

async fn ms_quotes(Query(q): Query<QuotesQuery>) -> Json<Value> {
    let quotes: Vec<Value> = q
        .symbols
        .split(',')
        .filter(|s| !s.is_empty())
        .map(fixtures::quote)
        .collect();
    Json(json!({ "quotes": quotes }))
}

async fn ms_watchlists() -> Json<Value> {
    let lists: Vec<Value> = fixtures::WATCHLISTS
        .iter()
        .map(|n| json!({"name": n, "entries": fixtures::watchlist_entries(n)}))
        .collect();
    Json(json!({ "watchlists": lists }))
}

async fn ms_watchlist(Path(name): Path<String>) -> Response {
    if !fixtures::WATCHLISTS.contains(&name.as_str()) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "no such watchlist"})),
        )
            .into_response();
    }
    Json(json!({"name": name, "entries": fixtures::watchlist_entries(&name)})).into_response()
}

async fn ms_ws(State(state): State<FakeState>, ws: WebSocketUpgrade) -> Response {
    ws.protocols(["json"])
        .on_upgrade(move |socket| ws_session(state, socket))
}

async fn ws_session(state: FakeState, mut socket: WebSocket) {
    let mut rx = state.ws.subscribe();
    let mut subscribed: Vec<String> = Vec::new();
    loop {
        tokio::select! {
            m = socket.recv() => match m {
                Some(Ok(Message::Text(t))) => {
                    let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                    if v["action"] == "subscribe" {
                        subscribed = v["tbks"].as_array().into_iter().flatten()
                            .filter_map(|x| x.as_str().map(str::to_owned)).collect();
                        let ack = json!({"action": "subscribed", "tbks": subscribed});
                        if socket.send(Message::text(ack.to_string())).await.is_err() {
                            return;
                        }
                    }
                }
                Some(Ok(_)) => {}
                _ => return,
            },
            p = rx.recv() => match p {
                Ok((key, data)) if subscribed.contains(&key) => {
                    let msg = json!({"key": key, "data": data});
                    if socket.send(Message::text(msg.to_string())).await.is_err() {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

// ---- fa-techan ------------------------------------------------------------

async fn fa_strategies(State(state): State<FakeState>) -> Json<Value> {
    Json(Value::Array(state.inner.lock().await.strategies.clone()))
}

// ---- Alpaca ---------------------------------------------------------------

/// The API key id, if the key and secret match a fake account.
fn api_key(h: &HeaderMap) -> Option<String> {
    let get = |name: &str| {
        h.get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
    };
    let (key, secret) = (get("apca-api-key-id"), get("apca-api-secret-key"));
    ACCOUNTS
        .iter()
        .find(|a| a.key == key && a.secret == secret)
        .map(|_| key.to_owned())
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"message": "access key verification failed"})),
    )
        .into_response()
}

async fn al_positions(State(state): State<FakeState>, h: HeaderMap) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    let positions = state.inner.lock().await.positions.get(&k).cloned();
    Json(positions.unwrap_or_default()).into_response()
}

#[derive(Deserialize)]
struct OrdersQuery {
    status: Option<String>,
}

async fn al_orders(
    State(state): State<FakeState>,
    h: HeaderMap,
    Query(q): Query<OrdersQuery>,
) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    let all = state
        .inner
        .lock()
        .await
        .orders
        .get(&k)
        .cloned()
        .unwrap_or_default();
    let open = |o: &Value| {
        !matches!(
            o["status"].as_str(),
            Some("filled" | "canceled" | "expired" | "rejected")
        )
    };
    let out: Vec<Value> = match q.status.as_deref().unwrap_or("open") {
        "open" => all.into_iter().filter(open).collect(),
        "closed" => all.into_iter().filter(|o| !open(o)).collect(),
        _ => all,
    };
    Json(out).into_response()
}

async fn al_create_order(
    State(state): State<FakeState>,
    h: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    let mut inner = state.inner.lock().await;
    let coid = body["client_order_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if !coid.is_empty()
        && inner
            .orders
            .get(&k)
            .is_some_and(|os| os.iter().any(|o| o["client_order_id"] == coid.as_str()))
    {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"message": "client_order_id must be unique"})),
        )
            .into_response();
    }
    inner.next_order += 1;
    let mut order = body.clone();
    order["id"] = json!(format!("fake-order-{}", inner.next_order));
    order["status"] = json!("accepted");
    order["created_at"] = json!("2026-09-25T15:00:00Z");
    inner.orders.entry(k).or_default().push(order.clone());
    Json(order).into_response()
}

async fn al_order_patch(
    State(state): State<FakeState>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    let mut inner = state.inner.lock().await;
    let Some(o) = inner
        .orders
        .get_mut(&k)
        .and_then(|os| os.iter_mut().find(|o| o["id"] == id.as_str()))
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"message": "order not found"})),
        )
            .into_response();
    };
    if let (Some(dst), Some(src)) = (o.as_object_mut(), body.as_object()) {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    Json(o.clone()).into_response()
}

async fn al_order_delete(
    State(state): State<FakeState>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    let mut inner = state.inner.lock().await;
    match inner
        .orders
        .get_mut(&k)
        .and_then(|os| os.iter_mut().find(|o| o["id"] == id.as_str()))
    {
        Some(o) => {
            o["status"] = json!("canceled");
            StatusCode::NO_CONTENT.into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"message": "order not found"})),
        )
            .into_response(),
    }
}

async fn al_position_delete(
    State(state): State<FakeState>,
    h: HeaderMap,
    Path(symbol): Path<String>,
) -> Response {
    let Some(k) = api_key(&h) else {
        return unauthorized();
    };
    if let Some(ps) = state.inner.lock().await.positions.get_mut(&k) {
        ps.retain(|p| p["symbol"] != symbol.as_str());
    }
    StatusCode::NO_CONTENT.into_response()
}

// ---- control --------------------------------------------------------------

async fn control_requests(State(state): State<FakeState>) -> Json<Vec<LoggedRequest>> {
    Json(state.requests().await)
}

async fn control_clear(State(state): State<FakeState>) -> StatusCode {
    state.inner.lock().await.requests.clear();
    StatusCode::NO_CONTENT
}

async fn control_reset(State(state): State<FakeState>) -> StatusCode {
    *state.inner.lock().await = Inner::seeded();
    StatusCode::NO_CONTENT
}

async fn control_fail(State(state): State<FakeState>, Json(rule): Json<FailRule>) -> StatusCode {
    state.inner.lock().await.rules.push(rule);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct Push {
    key: String,
    data: Value,
}

async fn control_push(State(state): State<FakeState>, Json(p): Json<Push>) -> StatusCode {
    state.push(&p.key, p.data);
    StatusCode::NO_CONTENT
}

async fn control_strategies(
    State(state): State<FakeState>,
    Json(rows): Json<Vec<Value>>,
) -> StatusCode {
    state.inner.lock().await.strategies = rows;
    StatusCode::NO_CONTENT
}

/// Orders the fake broker has accepted for an API key id.
async fn control_orders(State(state): State<FakeState>) -> Json<BTreeMap<String, Vec<Value>>> {
    Json(
        state
            .inner
            .lock()
            .await
            .orders
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    )
}

async fn ok_json() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Body::from("fake-backends: no route")).into_response()
}

/// Build the router for `state`.
pub fn router(state: FakeState) -> Router {
    Router::new()
        .route("/marketstore/v1/health", get(ok_json))
        .route("/marketstore/v1/bars/{symbol}", get(ms_bars))
        .route("/marketstore/v1/quotes", get(ms_quotes))
        .route("/marketstore/v1/watchlists", get(ms_watchlists))
        .route("/marketstore/v1/watchlists/{name}", get(ms_watchlist))
        .route("/marketstore/ws", get(ms_ws))
        .route("/fatechan/health", get(ok_json))
        .route("/fatechan/strategies/positions", get(fa_strategies))
        .route("/alpaca/v2/positions", get(al_positions))
        .route("/alpaca/v2/positions/{symbol}", delete(al_position_delete))
        .route("/alpaca/v2/orders", get(al_orders).post(al_create_order))
        .route(
            "/alpaca/v2/orders/{id}",
            delete(al_order_delete).patch(al_order_patch),
        )
        .route(
            "/__control/requests",
            get(control_requests).delete(control_clear),
        )
        .route("/__control/reset", post(control_reset))
        .route("/__control/fail", post(control_fail))
        .route("/__control/push", post(control_push))
        .route("/__control/strategies", post(control_strategies))
        .route("/__control/orders", get(control_orders))
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            record_and_fail,
        ))
        .with_state(state)
}

/// Serve on `listener` until the process exits.
pub async fn serve(listener: TcpListener, state: FakeState) -> std::io::Result<()> {
    axum::serve(listener, router(state)).await
}
