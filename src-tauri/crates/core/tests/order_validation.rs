//! Ported from __tests__/orderValidation.test.ts.

use serde_json::json;
use ta_core::broker::validate::{OrderForm, to_request, validate};
use ta_core::broker::{OrderSide, OrderType, TimeInForce};

fn base() -> OrderForm {
    OrderForm {
        symbol: "AAPL".into(),
        side: OrderSide::Buy,
        order_type: OrderType::Market,
        time_in_force: TimeInForce::Day,
        qty: "10".into(),
        notional: String::new(),
        limit_price: String::new(),
        stop_price: String::new(),
        trail_percent: String::new(),
        extended_hours: false,
        use_notional: false,
    }
}

#[test]
fn valid_market_order_has_no_errors() {
    assert!(validate(&base()).is_empty());
}

#[test]
fn missing_symbol_is_an_error() {
    assert!(
        validate(&OrderForm {
            symbol: "  ".into(),
            ..base()
        })
        .contains(&"Symbol is required.")
    );
}

#[test]
fn non_positive_qty_is_an_error() {
    for q in ["0", "-1", "", "abc", "inf"] {
        assert!(
            validate(&OrderForm {
                qty: q.into(),
                ..base()
            })
            .contains(&"Quantity must be a positive number."),
            "{q}"
        );
    }
}

#[test]
fn non_positive_notional_is_an_error_when_notional_is_used() {
    let f = OrderForm {
        use_notional: true,
        qty: String::new(),
        notional: "0".into(),
        ..base()
    };
    assert_eq!(validate(&f), ["Notional must be a positive number."]);
}

#[test]
fn limit_order_requires_a_limit_price() {
    let f = OrderForm {
        order_type: OrderType::Limit,
        ..base()
    };
    assert!(validate(&f).contains(&"Limit price is required for limit orders."));
}

#[test]
fn stop_limit_requires_both_prices() {
    let f = OrderForm {
        order_type: OrderType::StopLimit,
        ..base()
    };
    assert_eq!(
        validate(&f),
        [
            "Limit price is required for limit orders.",
            "Stop price is required for stop orders."
        ]
    );
}

#[test]
fn trailing_stop_requires_trail_percent() {
    let f = OrderForm {
        order_type: OrderType::TrailingStop,
        ..base()
    };
    assert!(validate(&f).contains(&"Trail percent is required for trailing stop orders."));
}

#[test]
fn limit_request_has_qty_and_limit_and_omits_stop() {
    let r = to_request(&OrderForm {
        order_type: OrderType::Limit,
        limit_price: "190".into(),
        symbol: " aapl ".into(),
        ..base()
    });
    assert_eq!(
        serde_json::to_value(r).unwrap(),
        json!({"symbol":"AAPL","side":"buy","type":"limit","time_in_force":"day","qty":"10","limit_price":"190","extended_hours":false})
    );
}

#[test]
fn notional_request_omits_qty() {
    let r = to_request(&OrderForm {
        use_notional: true,
        qty: String::new(),
        notional: "500".into(),
        ..base()
    });
    assert_eq!(r.notional.as_deref(), Some("500"));
    assert_eq!(r.qty, None);
}

#[test]
fn market_request_omits_every_price_field() {
    assert_eq!(
        serde_json::to_value(to_request(&base())).unwrap(),
        json!({"symbol":"AAPL","side":"buy","type":"market","time_in_force":"day","qty":"10","extended_hours":false})
    );
}

#[test]
fn stop_limit_and_trailing_requests_carry_their_fields_only() {
    let r = to_request(&OrderForm {
        order_type: OrderType::StopLimit,
        limit_price: "10".into(),
        stop_price: "9".into(),
        trail_percent: "5".into(),
        ..base()
    });
    assert_eq!(
        (
            r.limit_price.as_deref(),
            r.stop_price.as_deref(),
            r.trail_percent
        ),
        (Some("10"), Some("9"), None)
    );
    let r = to_request(&OrderForm {
        order_type: OrderType::TrailingStop,
        trail_percent: "5".into(),
        limit_price: "10".into(),
        ..base()
    });
    assert_eq!(
        (r.limit_price, r.trail_percent.as_deref()),
        (None, Some("5"))
    );
}
