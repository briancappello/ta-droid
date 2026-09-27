use fake_backends::{FakeState, LoggedRequest};

async fn start(state: FakeState) -> String {
    ta_core::net::install_default_crypto_provider();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(fake_backends::serve(listener, state));
    base
}

#[tokio::test]
async fn health_endpoints_answer_200() {
    let base = start(FakeState::default()).await;
    for path in ["/marketstore/v1/health", "/fatechan/health"] {
        let res = reqwest::get(format!("{base}{path}")).await.unwrap();
        assert_eq!(res.status(), 200, "{path}");
    }
}

#[tokio::test]
async fn requests_are_logged_with_headers_and_readable_back() {
    let state = FakeState::default();
    let base = start(state.clone()).await;
    let client = reqwest::Client::new();
    client
        .get(format!("{base}/marketstore/v1/health?probe=1"))
        .header("Authorization", "Bearer test-token")
        .send()
        .await
        .unwrap();

    let logged: Vec<LoggedRequest> = client
        .get(format!("{base}/__control/requests"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(logged.len(), 1, "control calls are not logged");
    let r = &logged[0];
    assert_eq!(r.method, "GET");
    assert_eq!(r.path, "/marketstore/v1/health");
    assert_eq!(r.query.as_deref(), Some("probe=1"));
    assert!(
        r.headers
            .iter()
            .any(|(k, v)| k == "authorization" && v == "Bearer test-token")
    );
    assert_eq!(state.requests().await, logged);

    let cleared = client
        .delete(format!("{base}/__control/requests"))
        .send()
        .await
        .unwrap();
    assert_eq!(cleared.status(), 204);
    assert!(state.requests().await.is_empty());
}

#[tokio::test]
async fn log_file_gets_one_json_line_per_request() {
    let dir = std::env::temp_dir().join(format!("fake-backends-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("requests.jsonl");
    let _ = std::fs::remove_file(&path);
    let base = start(FakeState::with_log_file(path.clone())).await;

    reqwest::get(format!("{base}/fatechan/health"))
        .await
        .unwrap();
    reqwest::get(format!("{base}/nope")).await.unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<LoggedRequest> = text
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        lines.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(),
        ["/fatechan/health", "/nope"]
    );
    std::fs::remove_dir_all(&dir).unwrap();
}
