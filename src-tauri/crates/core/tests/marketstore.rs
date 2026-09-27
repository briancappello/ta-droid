//! Ported from __tests__/marketstore.test.ts, apiHistory.test.ts,
//! apiQuotes.test.ts, and watchlists.test.ts.

use serde_json::json;
use ta_core::config::Profile;
use ta_core::marketstore::{self as ms, MarketDataError};
use ta_core::profiles::Backend;
use ta_core::store::MemoryStore;
use ta_core::watchlists;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn backend(url: &str) -> Backend {
    let p = Profile {
        name: "t".into(),
        marketstore_url: url.into(),
        fatechan_url: url.into(),
        auth_headers: vec![],
        ca_cert_pem: None,
    };
    Backend::new(&p, &MemoryStore::default()).unwrap()
}

#[test]
fn freq_to_timeframe_maps_app_frequencies() {
    for (f, tf) in [
        ("1min", "1Min"),
        ("2min", "2Min"),
        ("5min", "5Min"),
        ("10min", "10Min"),
        ("15min", "15Min"),
        ("30min", "30Min"),
        ("h", "1H"),
        ("D", "1D"),
        ("W", "1W"),
        ("M", "1M"),
    ] {
        assert_eq!(ms::freq_to_timeframe(f).unwrap(), tf);
    }
}

#[test]
fn unknown_frequency_is_an_error() {
    let e = ms::freq_to_timeframe("bogus").unwrap_err();
    assert_eq!(e.to_string(), "Unknown frequency: bogus");
}

#[tokio::test]
async fn unknown_frequency_makes_no_request() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let e = ms::history(&backend(&server.uri()), "AAPL", "bogus", None)
        .await
        .unwrap_err();
    assert!(matches!(e, MarketDataError::UnknownFrequency(_)));
}

#[tokio::test]
async fn bars_requests_the_bars_endpoint_with_timeframe_and_limit() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/bars/AAPL"))
        .and(query_param("timeframe", "1D"))
        .and(query_param("limit", "50"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"symbol":"AAPL","timeframe":"1D","bars":[]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    ms::bars(&backend(&server.uri()), "AAPL", "1D", 50)
        .await
        .unwrap();
}

#[tokio::test]
async fn quotes_join_symbols_and_default_to_1d_and_map_the_shape() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/quotes"))
        .and(query_param("symbols", "AAPL,NEW"))
        .and(query_param("timeframe", "1D"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"quotes": [
            {"symbol":"AAPL","time":"2024-01-15T00:00:00Z","open":1.5,"high":2.5,"low":1,"close":2,"volume":1200,"prev_close":1.5},
            {"symbol":"NEW","time":"2024-01-15T00:00:00Z","open":5,"high":5,"low":5,"close":5,"volume":1,"prev_close":null}
        ]})))
        .expect(1)
        .mount(&server)
        .await;
    let q = ms::quotes(&backend(&server.uri()), &["AAPL".into(), "NEW".into()])
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&q[0]).unwrap(),
        json!({"ticker":"AAPL","date":"2024-01-15T00:00:00Z","open":1.5,"high":2.5,"low":1.0,"close":2.0,"volume":1200.0,"prev_close":1.5})
    );
    assert_eq!(q[1].prev_close, None);
}

#[tokio::test]
async fn empty_symbol_list_makes_no_request() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    assert!(
        ms::quotes(&backend(&server.uri()), &[])
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn watchlists_map_names_to_friendly_labels() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/watchlists"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"watchlists":[
            {"name":"MOMENTUM","entries":[]},{"name":"FOO_BAR","entries":[]}]})),
        )
        .mount(&server)
        .await;
    let w = watchlists::list(&backend(&server.uri())).await.unwrap();
    assert_eq!(
        serde_json::to_value(w).unwrap(),
        json!([{"id":"MOMENTUM","name":"Momentum"},{"id":"FOO_BAR","name":"FOO_BAR"}])
    );
}

#[tokio::test]
async fn watchlist_entries_request_by_name_and_merge_fields() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/watchlists/MOMENTUM"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"name":"MOMENTUM","entries":[
            {"symbol":"INTU","rank":1,"sector":"Tech","fields":{"price":345,"prior_close":357,"open":300}}]})))
        .expect(1)
        .mount(&server)
        .await;
    let rows = watchlists::entries(&backend(&server.uri()), "MOMENTUM")
        .await
        .unwrap();
    assert_eq!(rows[0].symbol, "INTU");
    assert_eq!(rows[0].change_pct, Some(15.0));
}

#[tokio::test]
async fn non_2xx_surfaces_the_server_error_message_or_the_status() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/bars/NOPE"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error":"symbol not found"})))
        .mount(&server)
        .await;
    Mock::given(path("/v1/bars/BAD"))
        .respond_with(ResponseTemplate::new(502).set_body_string("<html>bad gateway</html>"))
        .mount(&server)
        .await;
    let b = backend(&server.uri());
    assert_eq!(
        ms::bars(&b, "NOPE", "1D", 10)
            .await
            .unwrap_err()
            .to_string(),
        "symbol not found"
    );
    assert_eq!(
        ms::bars(&b, "BAD", "1D", 10).await.unwrap_err().to_string(),
        "Market data error: 502"
    );
}

#[tokio::test]
async fn network_failure_surfaces_a_friendly_message() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let e = ms::quotes(&backend(&url), &["AAPL".into()])
        .await
        .unwrap_err();
    assert_eq!(
        e.to_string(),
        "Can't reach market data — check your connection."
    );
}

fn bars_json(bars: serde_json::Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({"symbol":"AAPL","timeframe":"1D","bars":bars}))
}

#[tokio::test]
async fn history_maps_frequency_and_over_fetches_warmup() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/bars/AAPL"))
        .and(query_param("timeframe", "5Min"))
        .and(query_param("limit", "300"))
        .respond_with(bars_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let h = ms::history(&backend(&server.uri()), "AAPL", "5min", Some(100))
        .await
        .unwrap();
    assert_eq!(h, ms::History::default());
    assert_eq!(
        serde_json::to_value(&h).unwrap(),
        json!({"columns":[],"index":[],"data":[]})
    );
}

#[tokio::test]
async fn history_is_columnar_with_ms_index_and_indicator_columns() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/bars/AAPL"))
        .respond_with(bars_json(json!([
            {"time":"2024-01-12T00:00:00Z","open":1,"high":2,"low":0.5,"close":1.5,"volume":1000},
            {"time":"2024-01-15T00:00:00Z","open":1.5,"high":2.5,"low":1,"close":2,"volume":1200}
        ])))
        .mount(&server)
        .await;
    let h = ms::history(&backend(&server.uri()), "AAPL", "D", Some(2))
        .await
        .unwrap();
    assert_eq!(
        h.columns,
        [
            "open",
            "high",
            "low",
            "close",
            "volume",
            "sma20",
            "sma100",
            "sma200",
            "bbands_upper",
            "bbands_lower",
            "macd",
            "macd_signal",
            "macd_difference",
            "rsi"
        ]
    );
    assert_eq!(h.index, [1_705_017_600_000, 1_705_276_800_000]);
    assert_eq!(
        h.data[0][..5],
        [Some(1.0), Some(2.0), Some(0.5), Some(1.5), Some(1000.0)]
    );
    assert_eq!(
        h.data[1][..5],
        [Some(1.5), Some(2.5), Some(1.0), Some(2.0), Some(1200.0)]
    );
    assert_eq!(
        h.data[0][h.columns.iter().position(|c| c == "sma200").unwrap()],
        None
    );
}

#[test]
fn history_slices_off_the_warmup_prefix() {
    let bars: Vec<ms::Bar> = (0..250)
        .map(|i| ms::Bar {
            time: chrono::DateTime::from_timestamp(1_704_067_200 + i * 86_400, 0)
                .unwrap()
                .to_rfc3339(),
            open: i as f64,
            high: i as f64 + 1.0,
            low: i as f64 - 1.0,
            close: i as f64 + 0.5,
            volume: 10.0,
        })
        .collect();
    let h = ms::build_history(&bars, 50).unwrap();
    assert_eq!(h.index.len(), 50);
    let s200 = h.columns.iter().position(|c| c == "sma200").unwrap();
    assert!(h.data[49][s200].is_some());
}

fn obj(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    v.as_object().unwrap().clone()
}

#[test]
fn watch_row_price_colors_vs_prior_close_and_change_is_from_open() {
    let r = watchlists::to_row(&obj(
        json!({"symbol":"INTU","price":345,"prior_close":357,"open":300}),
    ));
    assert_eq!(
        serde_json::to_value(r).unwrap(),
        json!({"symbol":"INTU","price":345.0,"price_up":false,"change_pct":15.0,"change_up":true,"agg_pct":null})
    );
}

#[test]
fn watch_row_directions_are_independent() {
    let r = watchlists::to_row(&obj(
        json!({"symbol":"GWRE","price":110,"prior_close":100,"open":125}),
    ));
    assert_eq!(
        (r.price_up, r.change_pct, r.change_up),
        (Some(true), Some(-12.0), Some(false))
    );
}

#[test]
fn watch_row_guards_a_zero_or_missing_open() {
    let r = watchlists::to_row(&obj(
        json!({"symbol":"HALT","price":10,"prior_close":9,"open":0}),
    ));
    assert_eq!(
        (r.change_pct, r.change_up, r.price),
        (None, None, Some(10.0))
    );
    let r = watchlists::to_row(&obj(json!({"symbol":"HALT","price":10})));
    assert_eq!((r.change_pct, r.price_up), (None, None));
}

#[test]
fn watch_row_aggregates_carry_avg_pct_change() {
    let r = watchlists::to_row(&obj(json!({"symbol":"Industrials","avg_pct_change":8.07})));
    assert_eq!(
        serde_json::to_value(r).unwrap(),
        json!({"symbol":"Industrials","price":null,"price_up":null,"change_pct":null,"change_up":null,"agg_pct":8.07})
    );
}

#[test]
fn watchlist_stream_key() {
    assert_eq!(
        watchlists::stream_key("MOMENTUM"),
        "WATCHLISTS/1Min/MOMENTUM"
    );
}
