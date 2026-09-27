//! Ported from __tests__/alpaca.test.ts, alpacaDriver.test.ts, and
//! broker.test.ts.

use std::time::Duration;

use serde_json::json;
use ta_core::accounts::Account;
use ta_core::broker::alpaca::{Alpaca, AlpacaError};
use ta_core::broker::{
    NewOrderRequest, OrderFilter, OrderQueryStatus, OrderSide, OrderType, ReplaceOrderRequest,
    TimeInForce,
};
use ta_core::config::{BrokerHosts, BrokerId, default_broker_hosts};
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn account(is_paper: bool) -> Account {
    Account {
        broker: BrokerId::Alpaca,
        id: if is_paper { "PA1" } else { "A1" }.into(),
        name: if is_paper { "Paper" } else { "Live" }.into(),
        is_paper,
        key: "K".into(),
        secret: "S".into(),
    }
}

async fn servers() -> (MockServer, MockServer, Alpaca) {
    let paper = MockServer::start().await;
    let live = MockServer::start().await;
    let a = Alpaca::new(BrokerHosts {
        paper: paper.uri(),
        live: live.uri(),
    })
    .unwrap();
    (paper, live, a)
}

fn market_buy() -> NewOrderRequest {
    NewOrderRequest {
        symbol: "AAPL".into(),
        side: OrderSide::Buy,
        order_type: OrderType::Market,
        time_in_force: TimeInForce::Day,
        qty: Some("1".into()),
        notional: None,
        limit_price: None,
        stop_price: None,
        trail_percent: None,
        extended_hours: None,
        client_order_id: None,
    }
}

fn order_json(id: &str) -> serde_json::Value {
    json!({"id": id, "symbol": "AAPL", "type": "market", "side": "buy", "status": "accepted"})
}

#[test]
fn default_hosts_are_alpaca_production() {
    let h = &default_broker_hosts()[&BrokerId::Alpaca];
    assert_eq!(h.paper, "https://paper-api.alpaca.markets");
    assert_eq!(h.live, "https://api.alpaca.markets");
}

#[tokio::test]
async fn list_positions_gets_on_the_paper_host_with_auth_headers() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("GET"))
        .and(path("/v2/positions"))
        .and(header("APCA-API-KEY-ID", "K"))
        .and(header("APCA-API-SECRET-KEY", "S"))
        .and(header("Content-Type", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"symbol":"AAPL","qty":"10","side":"long","avg_entry_price":"1","market_value":"10","unrealized_pl":"0"}
        ])))
        .expect(1)
        .mount(&paper)
        .await;
    let p = a.list_positions(&account(true)).await.unwrap();
    assert_eq!(p[0].symbol, "AAPL");
}

#[tokio::test]
async fn live_account_uses_the_live_host() {
    let (paper, live, a) = servers().await;
    Mock::given(path("/v2/positions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&live)
        .await;
    Mock::given(path("/v2/positions"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&paper)
        .await;
    a.list_positions(&account(false)).await.unwrap();
}

#[tokio::test]
async fn a_redirect_is_not_followed() {
    let (paper, _live, a) = servers().await;
    let elsewhere = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(0)
        .mount(&elsewhere)
        .await;
    Mock::given(path("/v2/positions"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("Location", format!("{}/steal", elsewhere.uri())),
        )
        .mount(&paper)
        .await;
    let e = a.list_positions(&account(true)).await.unwrap_err();
    assert_eq!(
        e,
        AlpacaError {
            status: 302,
            message: "Alpaca error (302).".into()
        }
    );
}

#[tokio::test]
async fn list_orders_maps_the_filter_to_query_params_default_open() {
    let (paper, _live, a) = servers().await;
    Mock::given(path("/v2/orders"))
        .and(query_param("status", "open"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&paper)
        .await;
    Mock::given(path("/v2/orders"))
        .and(query_param("status", "closed"))
        .and(query_param("limit", "5"))
        .and(query_param("after", "2026-01-01"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&paper)
        .await;
    let acct = account(true);
    a.list_orders(&acct, &OrderFilter::default()).await.unwrap();
    a.list_orders(
        &acct,
        &OrderFilter {
            status: OrderQueryStatus::Closed,
            limit: Some(5),
            after: Some("2026-01-01".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn create_order_posts_once_with_a_generated_client_order_id() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("POST"))
        .and(path("/v2/orders"))
        .respond_with(|req: &Request| {
            let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
            assert!(body["client_order_id"].as_str().unwrap().starts_with("ta-"));
            assert_eq!(body["type"], "market");
            assert!(body.get("limit_price").is_none());
            ResponseTemplate::new(200).set_body_json(order_json("o1"))
        })
        .expect(1)
        .mount(&paper)
        .await;
    let o = a.create_order(&account(true), &market_buy()).await.unwrap();
    assert_eq!(o.id, "o1");
}

#[tokio::test]
async fn create_order_is_not_retried_after_a_failure() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&paper)
        .await;
    let e = a
        .create_order(&account(true), &market_buy())
        .await
        .unwrap_err();
    assert_eq!(e.message, "Alpaca error (500).");
}

#[tokio::test]
async fn a_given_client_order_id_is_kept() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("POST"))
        .and(body_json(json!({"symbol":"AAPL","side":"buy","type":"market","time_in_force":"day","qty":"1","client_order_id":"mine"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(order_json("o2")))
        .expect(1)
        .mount(&paper)
        .await;
    let mut req = market_buy();
    req.client_order_id = Some("mine".into());
    a.create_order(&account(true), &req).await.unwrap();
}

#[tokio::test]
async fn close_position_deletes_the_symbol_and_tolerates_an_empty_204() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("DELETE"))
        .and(path("/v2/positions/AAPL"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&paper)
        .await;
    a.close_position(&account(true), "AAPL").await.unwrap();
}

#[tokio::test]
async fn replace_order_patches_and_cancel_order_deletes_the_id() {
    let (paper, _live, a) = servers().await;
    Mock::given(method("PATCH"))
        .and(path("/v2/orders/o1"))
        .and(body_json(json!({"qty":"5"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(order_json("o1")))
        .expect(1)
        .mount(&paper)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v2/orders/o1"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&paper)
        .await;
    let acct = account(true);
    a.replace_order(
        &acct,
        "o1",
        &ReplaceOrderRequest {
            qty: Some("5".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    a.cancel_order(&acct, "o1").await.unwrap();
}

#[tokio::test]
async fn error_statuses_map_to_the_spec_messages() {
    let (paper, _live, a) = servers().await;
    let cases = [
        (401, json!({}), "Check the API keys for this account."),
        (403, json!({}), "Check the API keys for this account."),
        (429, json!({}), "Rate limited by Alpaca, retry shortly."),
        (
            422,
            json!({"message": "qty must be > 0"}),
            "qty must be > 0",
        ),
        (
            422,
            json!({}),
            "Alpaca rejected the request (validation error).",
        ),
        (500, json!({}), "Alpaca error (500)."),
    ];
    let acct = account(true);
    for (status, body, want) in cases {
        paper.reset().await;
        Mock::given(path("/v2/positions"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&paper)
            .await;
        let e = a.list_positions(&acct).await.unwrap_err();
        assert_eq!((e.status, e.message.as_str()), (status, want));
    }
}

#[tokio::test]
async fn timeout_is_status_0_timed_out() {
    let paper = MockServer::start().await;
    Mock::given(path("/v2/positions"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(500)))
        .mount(&paper)
        .await;
    let a = Alpaca::with_timeout(
        BrokerHosts {
            paper: paper.uri(),
            live: paper.uri(),
        },
        Duration::from_millis(50),
    )
    .unwrap();
    let e = a.list_positions(&account(true)).await.unwrap_err();
    assert_eq!(
        e,
        AlpacaError {
            status: 0,
            message: "Alpaca request timed out.".into()
        }
    );
}

#[tokio::test]
async fn network_failure_is_status_0_cant_reach() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let a = Alpaca::new(BrokerHosts {
        paper: url.clone(),
        live: url,
    })
    .unwrap();
    let e = a.list_positions(&account(true)).await.unwrap_err();
    assert_eq!(
        e,
        AlpacaError {
            status: 0,
            message: "Can't reach Alpaca — check your connection.".into()
        }
    );
}

#[test]
fn unknown_broker_is_rejected_at_parse_time() {
    assert!(serde_json::from_str::<BrokerId>("\"nope\"").is_err());
}
