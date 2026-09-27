use serde_json::json;
use ta_core::stream::{StreamMessage, as_bar, as_watchlist_rows, bar_key};

fn msg(data: serde_json::Value) -> StreamMessage {
    StreamMessage {
        key: "k".into(),
        data,
    }
}

#[test]
fn bar_key_uppercases_the_symbol() {
    assert_eq!(bar_key("amd", "1Min"), "AMD/1Min/OHLCV");
}

#[test]
fn only_bar_messages_become_live_bars() {
    let b = as_bar(&msg(json!({"msg_type":"bar","payload":{"symbol":"AMD","open":1,"high":2,"low":0.5,"close":1.5,"volume":10,"epoch":1790366340}}))).unwrap();
    assert_eq!((b.close, b.epoch), (1.5, 1_790_366_340));
    assert!(as_bar(&msg(json!({"msg_type":"watchlist_update","payload":{}}))).is_none());
    assert!(
        as_bar(&msg(json!({"msg_type":"bar","payload":{"close":1}}))).is_none(),
        "incomplete payload"
    );
}

#[test]
fn watchlist_updates_replace_rows_from_payload_symbols() {
    let rows = as_watchlist_rows(&msg(
        json!({"msg_type":"watchlist_update","payload":{"symbols":[
            {"symbol":"INTU","price":345,"prior_close":357,"open":300},
            {"symbol":"Industrials","avg_pct_change":8.07}
        ]}}),
    ))
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].change_pct, Some(15.0));
    assert_eq!(rows[1].agg_pct, Some(8.07));
    assert!(as_watchlist_rows(&msg(json!({"msg_type":"bar","payload":{}}))).is_none());
}
