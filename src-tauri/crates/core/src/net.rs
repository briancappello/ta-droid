//! HTTP and TLS setup shared by every backend client (design D4).
//!
//! TLS is rustls with the `ring` provider and the Mozilla roots from
//! `webpki-roots`, plus an optional per-profile private CA. The same config
//! is used on every platform, so trust never depends on the device's store.

use std::sync::Arc;
use std::time::Duration;

use rustls::{ClientConfig, RootCertStore};
use rustls_pki_types::CertificateDer;
use rustls_pki_types::pem::PemObject;

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("the profile's CA certificate is not valid PEM")]
    BadCaPem,
    #[error("the profile's CA certificate was rejected: {0}")]
    BadCa(String),
    #[error("an auth header is not valid: {0}")]
    BadHeader(String),
    #[error("HTTP client setup failed: {0}")]
    Client(String),
}

/// Install `ring` as the process-wide rustls provider. Clients built here do
/// not need it, but any other rustls user in the process (for example a
/// plain `reqwest::Client::new()` in tests) does. Safe to call repeatedly.
pub fn install_default_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// A rustls client config trusting the Mozilla roots and `extra_ca_pem`.
pub fn tls_config(extra_ca_pem: Option<&str>) -> Result<ClientConfig, NetError> {
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Some(pem) = extra_ca_pem {
        let certs: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(pem.as_bytes())
            .collect::<Result<_, _>>()
            .map_err(|_| NetError::BadCaPem)?;
        if certs.is_empty() {
            return Err(NetError::BadCaPem);
        }
        for c in certs {
            roots.add(c).map_err(|e| NetError::BadCa(e.to_string()))?;
        }
    }
    let mut cfg = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| NetError::Client(e.to_string()))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    cfg.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(cfg)
}

/// Like [`tls_config`] for WebSockets, which must negotiate HTTP/1.1.
pub fn ws_tls_config(extra_ca_pem: Option<&str>) -> Result<ClientConfig, NetError> {
    let mut cfg = tls_config(extra_ca_pem)?;
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(cfg)
}

/// Options for one HTTP client.
pub struct ClientOptions<'a> {
    pub extra_ca_pem: Option<&'a str>,
    /// Sent on every request; values are marked sensitive.
    pub headers: &'a [(String, String)],
    pub timeout: Option<Duration>,
    pub follow_redirects: bool,
}

pub fn http_client(opts: ClientOptions<'_>) -> Result<reqwest::Client, NetError> {
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in opts.headers {
        let n = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| NetError::BadHeader(name.clone()))?;
        let mut v = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| NetError::BadHeader(name.clone()))?;
        v.set_sensitive(true);
        headers.insert(n, v);
    }
    let mut b = reqwest::Client::builder()
        .tls_backend_preconfigured(tls_config(opts.extra_ca_pem)?)
        .default_headers(headers)
        .redirect(if opts.follow_redirects {
            reqwest::redirect::Policy::limited(5)
        } else {
            reqwest::redirect::Policy::none()
        });
    if let Some(t) = opts.timeout {
        b = b.timeout(t);
    }
    b.build().map_err(|e| NetError::Client(e.to_string()))
}
