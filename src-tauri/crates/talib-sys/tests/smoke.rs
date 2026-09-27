use talib_sys::{bbands, macd, rsi, sma};

#[test]
fn sma_matches_hand_computed_values_with_null_warmup() {
    let closes = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    let s = sma(&closes, 3).unwrap();
    assert_eq!(
        s,
        vec![None, None, Some(2.0), Some(3.0), Some(4.0), Some(5.0)]
    );
}

#[test]
fn empty_and_too_short_inputs_give_all_none() {
    assert!(sma(&[], 3).unwrap().is_empty());
    assert_eq!(sma(&[1.0, 2.0], 3).unwrap(), vec![None, None]);
}

#[test]
fn bbands_middle_is_the_sma_and_bands_use_population_sigma() {
    let closes = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    let [upper, middle, lower] = bbands(&closes, 8, 2.0, 2.0).unwrap();
    // mean 5, population sigma 2 (sample sigma would be ~2.138)
    assert_eq!(middle[7], Some(5.0));
    assert!((upper[7].unwrap() - 9.0).abs() < 1e-12);
    assert!((lower[7].unwrap() - 1.0).abs() < 1e-12);
    assert!(middle[6].is_none());
}

#[test]
fn macd_and_rsi_warmup_lengths_match_ta_lib_lookback() {
    let closes: Vec<f64> = (0..100)
        .map(|i| 100.0 + (i as f64 * 0.7).sin() * 5.0)
        .collect();
    let [m, s, h] = macd(&closes, 12, 26, 9).unwrap();
    // TA-Lib MACD lookback = (slow - 1) + (signal - 1) = 33
    assert!(m[32].is_none() && m[33].is_some());
    for i in 33..100 {
        assert!((h[i].unwrap() - (m[i].unwrap() - s[i].unwrap())).abs() < 1e-12);
    }
    let r = rsi(&closes, 14).unwrap();
    // RSI lookback = period = 14
    assert!(r[13].is_none() && r[14].is_some());
    assert!(r.iter().flatten().all(|v| (0.0..=100.0).contains(v)));
}

#[test]
fn invalid_parameters_are_errors() {
    assert!(sma(&[1.0, 2.0, 3.0], 1).is_err());
}
