//! Test double for the three backends the app talks to.
//!
//! One HTTP listener serves everything under a prefix, so a single
//! `adb reverse` or `ssh -R` tunnel exposes all of it to a device:
//!
//! - `/marketstore/...` — MarketStore REST (and WS in later tasks)
//! - `/fatechan/...`    — fa-techan
//! - `/alpaca/...`      — Alpaca trading API
//! - `/__control/...`   — test control: request log, scripted failures
//!
//! Every request to a backend prefix is recorded, including headers, so
//! tests can assert what the app sent (and that no secret went where it
//! must not).

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// One recorded request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoggedRequest {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: Vec<(String, String)>,
}

#[derive(Default)]
struct Inner {
    requests: Vec<LoggedRequest>,
}

/// Shared server state.
#[derive(Clone, Default)]
pub struct FakeState {
    inner: Arc<Mutex<Inner>>,
    log_path: Option<Arc<PathBuf>>,
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
}

async fn record_request(State(state): State<FakeState>, req: Request, next: Next) -> Response {
    let uri = req.uri();
    if !uri.path().starts_with("/__control") {
        let entry = LoggedRequest {
            method: req.method().to_string(),
            path: uri.path().to_owned(),
            query: uri.query().map(str::to_owned),
            headers: req
                .headers()
                .iter()
                .map(|(k, v)| {
                    (
                        k.to_string(),
                        String::from_utf8_lossy(v.as_bytes()).into_owned(),
                    )
                })
                .collect(),
        };
        state.record(entry).await;
    }
    next.run(req).await
}

async fn ok_json() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn control_requests(State(state): State<FakeState>) -> Json<Vec<LoggedRequest>> {
    Json(state.requests().await)
}

async fn control_clear(State(state): State<FakeState>) -> StatusCode {
    state.inner.lock().await.requests.clear();
    StatusCode::NO_CONTENT
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Body::from("fake-backends: no route")).into_response()
}

/// Build the router for `state`.
pub fn router(state: FakeState) -> Router {
    Router::new()
        .route("/marketstore/v1/health", get(ok_json))
        .route("/fatechan/health", get(ok_json))
        .route(
            "/__control/requests",
            get(control_requests).delete(control_clear),
        )
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            record_request,
        ))
        .with_state(state)
}

/// Serve on `listener` until the process exits.
pub async fn serve(listener: TcpListener, state: FakeState) -> std::io::Result<()> {
    axum::serve(listener, router(state)).await
}
