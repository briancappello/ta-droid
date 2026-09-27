//! Ported from __tests__/flatten.test.ts, plus retrying only failed legs.

use serde_json::json;
use ta_core::accounts::Account;
use ta_core::broker::alpaca::Alpaca;
use ta_core::broker::flatten::{self, Holding};
use ta_core::broker::{OrderSide, OrderType, Position, TimeInForce};
use ta_core::config::{BrokerHosts, BrokerId};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn account(id: &str, key: &str) -> Account {
    Account {
        broker: BrokerId::Alpaca,
        id: id.into(),
        name: id.to_uppercase(),
        is_paper: true,
        key: key.into(),
        secret: "S".into(),
    }
}

fn held(symbol: &str, qty: &str, side: &str) -> Position {
    serde_json::from_value(json!({
        "symbol": symbol, "qty": qty, "side": side, "avg_entry_price": "1",
        "market_value": "1", "unrealized_pl": "0"
    }))
    .unwrap()
}

#[test]
fn plan_makes_a_market_day_close_per_holding_on_the_opposite_side() {
    let (ira, paper) = (account("ira", "K1"), account("paper", "K2"));
    let legs = flatten::plan(&[
        Holding {
            account: &ira,
            position: held("AAPL", "100", "long"),
        },
        Holding {
            account: &paper,
            position: held("AAPL", "-20", "short"),
        },
    ]);
    assert_eq!(
        (legs[0].req.side, legs[0].req.qty.as_deref()),
        (OrderSide::Sell, Some("100"))
    );
    assert_eq!(
        (legs[1].req.side, legs[1].req.qty.as_deref()),
        (OrderSide::Buy, Some("20"))
    );
    for l in &legs {
        assert_eq!(
            (l.req.order_type, l.req.time_in_force, l.req.symbol.as_str()),
            (OrderType::Market, TimeInForce::Day, "AAPL")
        );
        assert!(l.req.client_order_id.as_deref().unwrap().starts_with("ta-"));
    }
    assert_ne!(legs[0].req.client_order_id, legs[1].req.client_order_id);
    let json = serde_json::to_string(&legs).unwrap();
    assert!(
        !json.contains("K1") && !json.contains("\"S\""),
        "legs carry no secrets: {json}"
    );
}

#[tokio::test]
async fn holdings_skip_a_failing_account_and_accounts_without_the_symbol() {
    let server = MockServer::start().await;
    let alpaca = Alpaca::new(BrokerHosts {
        paper: server.uri(),
        live: server.uri(),
    })
    .unwrap();
    Mock::given(path("/v2/positions"))
        .and(header("APCA-API-KEY-ID", "down"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    Mock::given(path("/v2/positions"))
        .and(header("APCA-API-KEY-ID", "has"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"symbol":"AAPL","qty":"50","side":"long","avg_entry_price":"1","market_value":"1","unrealized_pl":"0"}])))
        .mount(&server)
        .await;
    Mock::given(path("/v2/positions"))
        .and(header("APCA-API-KEY-ID", "none"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;
    let accts = [
        account("a", "down"),
        account("b", "has"),
        account("c", "none"),
    ];
    let h = flatten::holdings(&alpaca, &accts, "AAPL").await;
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].account.id, "b");
}

#[tokio::test]
async fn submit_reports_per_leg_and_a_retry_resends_only_the_failed_leg() {
    let server = MockServer::start().await;
    let alpaca = Alpaca::new(BrokerHosts {
        paper: server.uri(),
        live: server.uri(),
    })
    .unwrap();
    // Account "b" fails the first time and succeeds after.
    let fails = std::sync::atomic::AtomicUsize::new(0);
    Mock::given(method("POST"))
        .and(path("/v2/orders"))
        .respond_with(move |req: &Request| {
            let key = req
                .headers
                .get("APCA-API-KEY-ID")
                .unwrap()
                .to_str()
                .unwrap();
            if key == "Kb" && fails.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                return ResponseTemplate::new(422).set_body_json(json!({"message":"bad"}));
            }
            ResponseTemplate::new(200).set_body_json(
                json!({"id":"o","symbol":"AAPL","type":"market","side":"sell","status":"accepted"}),
            )
        })
        .mount(&server)
        .await;
    let accts = [account("a", "Ka"), account("b", "Kb"), account("c", "Kc")];
    let legs = flatten::plan(&[
        Holding {
            account: &accts[0],
            position: held("AAPL", "1", "long"),
        },
        Holding {
            account: &accts[1],
            position: held("AAPL", "2", "long"),
        },
        Holding {
            account: &accts[2],
            position: held("AAPL", "3", "long"),
        },
    ]);
    let first = flatten::submit(&alpaca, &accts, legs.clone()).await;
    assert!(!first.all_ok);
    assert_eq!(
        first.results.iter().map(|r| r.ok).collect::<Vec<_>>(),
        [true, false, true]
    );
    assert_eq!(first.results[1].error.as_deref(), Some("bad"));
    assert_eq!(first.remaining, [legs[1].clone()]);

    let second = flatten::submit(&alpaca, &accts, first.remaining).await;
    assert!(second.all_ok && second.remaining.is_empty());

    let posts: Vec<_> = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.method.as_str() == "POST")
        .collect();
    let keys: Vec<&str> = posts
        .iter()
        .map(|r| r.headers.get("APCA-API-KEY-ID").unwrap().to_str().unwrap())
        .collect();
    assert_eq!(keys.len(), 4, "3 legs, then only the failed one: {keys:?}");
    assert_eq!(keys.iter().filter(|k| **k == "Kb").count(), 2);
    let ids: Vec<String> = posts
        .iter()
        .filter(|r| r.headers.get("APCA-API-KEY-ID").unwrap() == "Kb")
        .map(|r| {
            serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["client_order_id"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(ids[0], ids[1], "a retry keeps the client order id");
}

#[tokio::test]
async fn all_ok_when_every_leg_succeeds() {
    let server = MockServer::start().await;
    let alpaca = Alpaca::new(BrokerHosts {
        paper: server.uri(),
        live: server.uri(),
    })
    .unwrap();
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"id":"o","symbol":"AAPL","type":"market","side":"sell","status":"accepted"}),
        ))
        .mount(&server)
        .await;
    let accts = [account("a", "Ka")];
    let legs = flatten::plan(&[Holding {
        account: &accts[0],
        position: held("AAPL", "1", "long"),
    }]);
    let out = flatten::submit(&alpaca, &accts, legs).await;
    assert!(out.all_ok && out.remaining.is_empty());
    assert!(
        serde_json::to_value(&out)
            .unwrap()
            .get("suppressed")
            .is_none()
    );
}
