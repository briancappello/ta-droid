//! Alpaca trading API client (trading spec: broker requests and errors).

use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;

use super::{NewOrderRequest, Order, OrderFilter, OrderQueryStatus, Position, ReplaceOrderRequest};
use crate::accounts::Account;
use crate::config::BrokerHosts;
use crate::net::{self, ClientOptions, NetError};

pub const TIMEOUT: Duration = Duration::from_secs(30);

/// A failed broker call. `status` is 0 when no HTTP response arrived.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[error("{message}")]
pub struct AlpacaError {
    pub status: u16,
    pub message: String,
}

impl AlpacaError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

fn message_for_status(status: u16, body: &str) -> String {
    match status {
        401 | 403 => "Check the API keys for this account.".into(),
        429 => "Rate limited by Alpaca, retry shortly.".into(),
        422 => serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_owned))
            .unwrap_or_else(|| "Alpaca rejected the request (validation error).".into()),
        s => format!("Alpaca error ({s})."),
    }
}

/// Alpaca client for one set of hosts. Never follows redirects, so the
/// secret headers never go to another host.
#[derive(Clone)]
pub struct Alpaca {
    client: reqwest::Client,
    hosts: BrokerHosts,
}

impl Alpaca {
    pub fn new(hosts: BrokerHosts) -> Result<Self, NetError> {
        let client = net::http_client(ClientOptions {
            extra_ca_pem: None,
            headers: &[],
            timeout: Some(TIMEOUT),
            follow_redirects: false,
        })?;
        Ok(Self { client, hosts })
    }

    /// Like [`Alpaca::new`] with a custom timeout (tests).
    pub fn with_timeout(hosts: BrokerHosts, timeout: Duration) -> Result<Self, NetError> {
        let client = net::http_client(ClientOptions {
            extra_ca_pem: None,
            headers: &[],
            timeout: Some(timeout),
            follow_redirects: false,
        })?;
        Ok(Self { client, hosts })
    }

    fn host(&self, a: &Account) -> &str {
        if a.is_paper {
            &self.hosts.paper
        } else {
            &self.hosts.live
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        a: &Account,
        method: reqwest::Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&impl Serialize>,
    ) -> Result<Option<T>, AlpacaError> {
        let mut req = self
            .client
            .request(
                method,
                format!("{}{}", self.host(a).trim_end_matches('/'), path),
            )
            .query(query)
            .header("APCA-API-KEY-ID", sensitive(&a.key)?)
            .header("APCA-API-SECRET-KEY", sensitive(&a.secret)?)
            .header("Content-Type", "application/json");
        if let Some(b) = body {
            req = req.body(serde_json::to_vec(b).expect("request serializes"));
        }
        let res = req.send().await.map_err(|e| {
            if e.is_timeout() {
                AlpacaError::new(0, "Alpaca request timed out.")
            } else {
                AlpacaError::new(0, "Can't reach Alpaca — check your connection.")
            }
        })?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AlpacaError::new(
                status.as_u16(),
                message_for_status(status.as_u16(), &text),
            ));
        }
        if status.as_u16() == 204 || text.is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&text).map(Some).map_err(|_| {
            AlpacaError::new(
                status.as_u16(),
                format!("Alpaca error ({}).", status.as_u16()),
            )
        })
    }

    pub async fn list_positions(&self, a: &Account) -> Result<Vec<Position>, AlpacaError> {
        Ok(self
            .request(a, reqwest::Method::GET, "/v2/positions", &[], None::<&()>)
            .await?
            .unwrap_or_default())
    }

    pub async fn list_orders(
        &self,
        a: &Account,
        filter: &OrderFilter,
    ) -> Result<Vec<Order>, AlpacaError> {
        let mut q = vec![(
            "status",
            match filter.status {
                OrderQueryStatus::Open => "open",
                OrderQueryStatus::Closed => "closed",
                OrderQueryStatus::All => "all",
            }
            .to_owned(),
        )];
        if let Some(v) = &filter.after {
            q.push(("after", v.clone()));
        }
        if let Some(v) = &filter.until {
            q.push(("until", v.clone()));
        }
        if let Some(v) = filter.limit {
            q.push(("limit", v.to_string()));
        }
        if let Some(v) = &filter.direction {
            q.push(("direction", v.clone()));
        }
        Ok(self
            .request(a, reqwest::Method::GET, "/v2/orders", &q, None::<&()>)
            .await?
            .unwrap_or_default())
    }

    /// Place an order. Never retried; a missing client order id gets a
    /// generated `ta-` one.
    pub async fn create_order(
        &self,
        a: &Account,
        req: &NewOrderRequest,
    ) -> Result<Order, AlpacaError> {
        let mut body = req.clone();
        body.client_order_id.get_or_insert_with(new_client_order_id);
        self.request(a, reqwest::Method::POST, "/v2/orders", &[], Some(&body))
            .await?
            .ok_or_else(|| AlpacaError::new(200, "Alpaca returned no order."))
    }

    pub async fn close_position(&self, a: &Account, symbol: &str) -> Result<(), AlpacaError> {
        self.request::<serde_json::Value>(
            a,
            reqwest::Method::DELETE,
            &format!("/v2/positions/{}", encode(symbol)),
            &[],
            None::<&()>,
        )
        .await
        .map(|_| ())
    }

    pub async fn replace_order(
        &self,
        a: &Account,
        id: &str,
        req: &ReplaceOrderRequest,
    ) -> Result<Order, AlpacaError> {
        self.request(
            a,
            reqwest::Method::PATCH,
            &format!("/v2/orders/{}", encode(id)),
            &[],
            Some(req),
        )
        .await?
        .ok_or_else(|| AlpacaError::new(200, "Alpaca returned no order."))
    }

    pub async fn cancel_order(&self, a: &Account, id: &str) -> Result<(), AlpacaError> {
        self.request::<serde_json::Value>(
            a,
            reqwest::Method::DELETE,
            &format!("/v2/orders/{}", encode(id)),
            &[],
            None::<&()>,
        )
        .await
        .map(|_| ())
    }
}

fn sensitive(v: &str) -> Result<reqwest::header::HeaderValue, AlpacaError> {
    let mut h = reqwest::header::HeaderValue::from_str(v)
        .map_err(|_| AlpacaError::new(0, "Check the API keys for this account."))?;
    h.set_sensitive(true);
    Ok(h)
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `ta-<unix ms>-<8 random base36 chars>`.
pub fn new_client_order_id() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut bytes = [0u8; 8];
    let _ = getrandom::fill(&mut bytes);
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let tail: String = bytes
        .iter()
        .map(|b| ALPHABET[(*b as usize) % 36] as char)
        .collect();
    format!("ta-{ms}-{tail}")
}
