//! Ported from __tests__/backendContext.test.tsx and the health cases of
//! __tests__/marketstore.test.ts and __tests__/techan.test.ts, plus the
//! profile requirements of the backend-profiles spec.

use std::sync::Arc;

use ta_core::config::{AppConfig, Profile};
use ta_core::keys;
use ta_core::profiles::{self, Backend, Health, ProfileView};
use ta_core::store::{KvStore, MemoryStore};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn profile(name: &str, ms: &str, fa: &str, auth: &[&str]) -> Profile {
    Profile {
        name: name.into(),
        marketstore_url: ms.into(),
        fatechan_url: fa.into(),
        auth_headers: auth.iter().map(|s| s.to_string()).collect(),
        ca_cert_pem: None,
    }
}

fn cfg(profiles: Vec<Profile>) -> AppConfig {
    let mut c = AppConfig::parse("[[profiles]]\nname='x'\nmarketstore_url='m'\nfatechan_url='f'\n")
        .unwrap();
    c.profiles = profiles;
    c
}

#[test]
fn active_profile_defaults_to_first_persists_and_falls_back() {
    let c = cfg(vec![
        profile("local", "m", "f", &[]),
        profile("taichi", "m2", "f2", &[]),
    ]);
    let prefs = MemoryStore::default();
    assert_eq!(profiles::active(&c, &prefs).name, "local");
    profiles::set_active(&c, &prefs, "taichi").unwrap();
    assert_eq!(profiles::active(&c, &prefs).name, "taichi");
    assert!(profiles::set_active(&c, &prefs, "nope").is_err());
    assert_eq!(profiles::active(&c, &prefs).name, "taichi");
    prefs.set(keys::ACTIVE_PROFILE, "removed").unwrap();
    assert_eq!(profiles::active(&c, &prefs).name, "local");
}

#[test]
fn profile_view_shows_auth_presence_but_no_header_values() {
    let mut p = profile(
        "remote",
        "https://m",
        "https://f",
        &["CF-Access-Client-Secret"],
    );
    p.ca_cert_pem = Some("pem".into());
    let v = ProfileView::from(&p);
    assert!(v.has_auth && v.has_custom_ca);
    let json = serde_json::to_string(&v).unwrap();
    assert!(!json.contains("CF-Access"), "{json}");
}

#[tokio::test]
async fn profile_headers_from_secrets_are_sent_to_both_backends_over_plain_http() {
    let server = MockServer::start().await;
    for p in ["/ms/v1/health", "/fa/health"] {
        Mock::given(method("GET"))
            .and(path(p))
            .and(header("cf-access-client-id", "cid"))
            .and(header("cf-access-client-secret", "csecret"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
    }
    let secrets = MemoryStore::default();
    secrets
        .set(
            &keys::backend_header("remote", "CF-Access-Client-Id"),
            "cid",
        )
        .unwrap();
    secrets
        .set(
            &keys::backend_header("remote", "CF-Access-Client-Secret"),
            "csecret",
        )
        .unwrap();
    let p = profile(
        "remote",
        &format!("{}/ms", server.uri()),
        &format!("{}/fa/", server.uri()),
        &["CF-Access-Client-Id", "CF-Access-Client-Secret"],
    );
    let b = Backend::new(&p, &secrets).unwrap();
    assert!(!format!("{b:?}").contains("csecret"));
    let r = profiles::health(&b).await;
    assert_eq!((r.marketstore, r.fatechan), (Health::Up, Health::Up));
}

#[tokio::test]
async fn one_backend_down_does_not_affect_the_other() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/health"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    // fa-techan: connection refused on a closed port.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let fa = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let b = Backend::new(
        &profile("p", &server.uri(), &fa, &[]),
        &MemoryStore::default(),
    )
    .unwrap();
    let r = profiles::health(&b).await;
    assert_eq!((r.marketstore, r.fatechan), (Health::Up, Health::Down));
}

#[tokio::test]
async fn non_2xx_is_down() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/health"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    Mock::given(path("/health"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let b = Backend::new(
        &profile("p", &server.uri(), &server.uri(), &[]),
        &MemoryStore::default(),
    )
    .unwrap();
    let r = profiles::health(&b).await;
    assert_eq!((r.marketstore, r.fatechan), (Health::Down, Health::Down));
}

/// A TLS server whose certificate is signed by a private CA.
async fn tls_server(issuer: &rcgen::Issuer<'_, rcgen::KeyPair>) -> String {
    let leaf_key = rcgen::KeyPair::generate().unwrap();
    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).unwrap();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "localhost");
    let leaf = params.signed_by(&leaf_key, issuer).unwrap();
    let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![leaf.der().clone()],
        rustls_pki_types::PrivateKeyDer::Pkcs8(leaf_key.serialize_der().into()),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut buf = [0u8; 2048];
                let _ = tls.read(&mut buf).await;
                let _ = tls
                    .write_all(
                        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok",
                    )
                    .await;
                let _ = tls.shutdown().await;
            });
        }
    });
    format!("https://localhost:{port}")
}

#[tokio::test]
async fn a_profile_ca_makes_a_private_ca_server_trusted() {
    let ca_key = rcgen::KeyPair::generate().unwrap();
    let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "ta-droid test CA");
    let ca = ca_params.self_signed(&ca_key).unwrap();
    let ca_pem = ca.pem();
    let issuer = rcgen::Issuer::new(ca_params, ca_key);
    let url = tls_server(&issuer).await;

    let without = Backend::new(&profile("p", &url, &url, &[]), &MemoryStore::default()).unwrap();
    let r = profiles::health(&without).await;
    assert_eq!(r.marketstore, Health::Down, "untrusted CA must be rejected");

    let mut p = profile("p", &url, &url, &[]);
    p.ca_cert_pem = Some(ca_pem);
    let with = Backend::new(&p, &MemoryStore::default()).unwrap();
    let r = profiles::health(&with).await;
    assert_eq!((r.marketstore, r.fatechan), (Health::Up, Health::Up));
}

#[test]
fn invalid_ca_pem_is_a_setup_error() {
    let mut p = profile("p", "https://m", "https://f", &[]);
    p.ca_cert_pem = Some("not a pem".into());
    assert!(Backend::new(&p, &MemoryStore::default()).is_err());
}
