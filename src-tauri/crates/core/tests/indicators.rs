//! Ported from __tests__/indicators.test.ts and
//! __tests__/indicatorCalibration.test.ts.

use ta_core::indicators::{COLUMNS, compute};

fn col(cols: &ta_core::indicators::Columns, name: &str) -> Vec<Option<f64>> {
    cols[COLUMNS.iter().position(|c| *c == name).unwrap()].clone()
}

#[test]
fn exposes_the_exact_column_set_the_chart_reads() {
    assert_eq!(
        COLUMNS,
        [
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
}

#[test]
fn returns_one_row_per_input_close() {
    let closes: Vec<f64> = (1..=50).map(f64::from).collect();
    assert!(compute(&closes).iter().all(|c| c.len() == 50));
}

#[test]
fn warmup_positions_are_null_until_the_period_fills() {
    let closes: Vec<f64> = (1..=250).map(f64::from).collect();
    let cols = compute(&closes);
    let (s100, s200) = (col(&cols, "sma100"), col(&cols, "sma200"));
    assert!(s100[98].is_none() && s100[99].is_some());
    assert!(s200[198].is_none() && s200[199].is_some());
}

#[test]
fn sma20_is_the_bollinger_middle_band() {
    let closes: Vec<f64> = (1..=40).map(f64::from).collect();
    let cols = compute(&closes);
    let (m, u, l) = (
        col(&cols, "sma20")[39].unwrap(),
        col(&cols, "bbands_upper")[39].unwrap(),
        col(&cols, "bbands_lower")[39].unwrap(),
    );
    assert!((m - 30.5).abs() < 1e-9);
    assert!(((u + l) / 2.0 - m).abs() < 1e-9);
}

#[test]
fn macd_difference_is_macd_minus_signal() {
    let closes: Vec<f64> = (0..60).map(|i| 100.0 + f64::from(i).sin()).collect();
    let cols = compute(&closes);
    let (m, s, d) = (
        col(&cols, "macd")[59].unwrap(),
        col(&cols, "macd_signal")[59].unwrap(),
        col(&cols, "macd_difference")[59].unwrap(),
    );
    assert!((d - (m - s)).abs() < 1e-9);
}

/// The reference fixture: fa-techan (TA-Lib 0.6.4 through the Python
/// binding) on AAPL, 400 daily rows, columnar.
#[derive(serde::Deserialize)]
struct Fixture {
    columns: Vec<String>,
    data: Vec<Vec<Option<f64>>>,
}

fn max_rel_on_tail(name: &str) -> f64 {
    let fx: Fixture = serde_json::from_str(include_str!("fixtures/faTechanHistory.json")).unwrap();
    let idx = |n: &str| fx.columns.iter().position(|c| c == n).unwrap();
    let closes: Vec<f64> = fx.data.iter().map(|r| r[idx("close")].unwrap()).collect();
    let ours = col(&compute(&closes), name);
    let theirs: Vec<Option<f64>> = fx.data.iter().map(|r| r[idx(name)]).collect();
    let from = closes.len() - 100;
    let mut max_rel: f64 = 0.0;
    for i in from..closes.len() {
        let (a, b) = (ours[i].expect("warm"), theirs[i].expect("fixture value"));
        max_rel = max_rel.max((a - b).abs() / b.abs().max(1e-6));
    }
    eprintln!("calibration {name} maxRel={max_rel:e}");
    max_rel
}

/// SMA and Bollinger columns do not depend on earlier history, so they match
/// fa-techan's own output exactly.
#[test]
fn window_columns_match_fa_techan_output_exactly() {
    for name in ["sma20", "sma100", "sma200", "bbands_upper", "bbands_lower"] {
        let r = max_rel_on_tail(name);
        assert!(r < 1e-9, "{name}: maxRel {r:e}");
    }
}

/// fa-techan computed the fixture over a longer history than its 400 rows,
/// so EMA-seeded columns carry a decayed seeding difference. It must stay
/// negligible (measured about 2e-8 for MACD).
#[test]
fn ema_columns_match_fa_techan_output_up_to_the_seeding_transient() {
    for name in ["macd", "macd_signal", "macd_difference", "rsi"] {
        let r = max_rel_on_tail(name);
        assert!(r < 1e-6, "{name}: maxRel {r:e}");
    }
}

/// On identical input, every column matches fa-techan's TA-Lib (Python
/// ta-lib 0.6.8 on C 0.6.4) to float precision, over every warm row.
#[test]
fn every_column_matches_fa_techan_talib_on_the_same_input() {
    #[derive(serde::Deserialize)]
    struct Reference {
        talib: String,
        columns: Vec<String>,
        data: Vec<Vec<Option<f64>>>,
    }
    let fx: Fixture = serde_json::from_str(include_str!("fixtures/faTechanHistory.json")).unwrap();
    let close = fx.columns.iter().position(|c| c == "close").unwrap();
    let closes: Vec<f64> = fx.data.iter().map(|r| r[close].unwrap()).collect();
    let rf: Reference = serde_json::from_str(include_str!("fixtures/talibSameInput.json")).unwrap();
    assert_eq!(rf.talib, "0.6.4");
    assert_eq!(rf.columns, COLUMNS);
    let ours = compute(&closes);
    for (c, name) in COLUMNS.iter().enumerate() {
        let mut max_rel: f64 = 0.0;
        for (i, row) in rf.data.iter().enumerate() {
            match (ours[c][i], row[c]) {
                (None, None) => {}
                (Some(a), Some(b)) => max_rel = max_rel.max((a - b).abs() / b.abs().max(1e-6)),
                (a, b) => panic!("{name}[{i}]: warmup differs: ours {a:?}, talib {b:?}"),
            }
        }
        eprintln!("same-input {name} maxRel={max_rel:e}");
        assert!(max_rel < 1e-9, "{name}: maxRel {max_rel:e}");
    }
}
