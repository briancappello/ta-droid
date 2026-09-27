//! TA-Lib C 0.6.4, vendored, with safe wrappers for the indicators the app
//! uses. Outputs are aligned with the input: warmup positions are `None`.

use std::os::raw::{c_double, c_int};
use std::sync::Once;

/// Raw bindings for the functions this crate wraps.
pub mod ffi {
    use super::{c_double, c_int};

    /// `TA_RetCode`; 0 is `TA_SUCCESS`.
    pub type RetCode = c_int;
    /// `TA_MAType`; 0 is `TA_MAType_SMA`.
    pub type MaType = c_int;
    pub const TA_SUCCESS: RetCode = 0;
    pub const TA_MATYPE_SMA: MaType = 0;

    unsafe extern "C" {
        pub fn TA_Initialize() -> RetCode;
        pub fn TA_SMA(
            start_idx: c_int,
            end_idx: c_int,
            in_real: *const c_double,
            time_period: c_int,
            out_beg_idx: *mut c_int,
            out_nb_element: *mut c_int,
            out_real: *mut c_double,
        ) -> RetCode;
        pub fn TA_BBANDS(
            start_idx: c_int,
            end_idx: c_int,
            in_real: *const c_double,
            time_period: c_int,
            nb_dev_up: c_double,
            nb_dev_dn: c_double,
            ma_type: MaType,
            out_beg_idx: *mut c_int,
            out_nb_element: *mut c_int,
            out_upper: *mut c_double,
            out_middle: *mut c_double,
            out_lower: *mut c_double,
        ) -> RetCode;
        pub fn TA_MACD(
            start_idx: c_int,
            end_idx: c_int,
            in_real: *const c_double,
            fast_period: c_int,
            slow_period: c_int,
            signal_period: c_int,
            out_beg_idx: *mut c_int,
            out_nb_element: *mut c_int,
            out_macd: *mut c_double,
            out_signal: *mut c_double,
            out_hist: *mut c_double,
        ) -> RetCode;
        pub fn TA_RSI(
            start_idx: c_int,
            end_idx: c_int,
            in_real: *const c_double,
            time_period: c_int,
            out_beg_idx: *mut c_int,
            out_nb_element: *mut c_int,
            out_real: *mut c_double,
        ) -> RetCode;
    }
}

/// A non-success `TA_RetCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaError(pub c_int);

impl std::fmt::Display for TaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TA-Lib returned code {}", self.0)
    }
}

impl std::error::Error for TaError {}

/// One indicator output aligned with its input.
pub type Series = Vec<Option<f64>>;

fn init() {
    static INIT: Once = Once::new();
    // Same as the Python binding does on import; sets the library defaults.
    INIT.call_once(|| {
        // SAFETY: no arguments; called once before any other TA-Lib call.
        let rc = unsafe { ffi::TA_Initialize() };
        assert_eq!(rc, ffi::TA_SUCCESS, "TA_Initialize failed");
    });
}

fn check(rc: ffi::RetCode) -> Result<(), TaError> {
    if rc == ffi::TA_SUCCESS {
        Ok(())
    } else {
        Err(TaError(rc))
    }
}

/// Place `n` computed values starting at `beg` into a `len`-long series.
fn align(len: usize, beg: c_int, n: c_int, out: &[f64]) -> Series {
    let mut s = vec![None; len];
    let (beg, n) = (beg as usize, n as usize);
    for (i, v) in out[..n].iter().enumerate() {
        s[beg + i] = Some(*v);
    }
    s
}

/// Run a TA-Lib function over the whole input. `f` gets the input bounds and
/// the output pointers; TA-Lib never writes more than `len` values.
fn run<const K: usize>(
    input: &[f64],
    f: impl FnOnce(c_int, *const c_double, *mut c_int, *mut c_int, [*mut c_double; K]) -> ffi::RetCode,
) -> Result<[Series; K], TaError> {
    init();
    let len = input.len();
    if len == 0 {
        return Ok(std::array::from_fn(|_| Vec::new()));
    }
    let end = c_int::try_from(len - 1).expect("input shorter than i32::MAX");
    let mut outs: [Vec<f64>; K] = std::array::from_fn(|_| vec![0.0; len]);
    let ptrs: [*mut c_double; K] = std::array::from_fn(|i| outs[i].as_mut_ptr());
    let (mut beg, mut n) = (0, 0);
    check(f(end, input.as_ptr(), &mut beg, &mut n, ptrs))?;
    Ok(std::array::from_fn(|i| align(len, beg, n, &outs[i])))
}

/// Simple moving average.
pub fn sma(input: &[f64], period: i32) -> Result<Series, TaError> {
    let [s] = run(input, |end, inp, beg, n, [out]| {
        // SAFETY: `inp` has end+1 values; `out` has room for as many.
        unsafe { ffi::TA_SMA(0, end, inp, period, beg, n, out) }
    })?;
    Ok(s)
}

/// Bollinger Bands over an SMA: `(upper, middle, lower)`.
pub fn bbands(
    input: &[f64],
    period: i32,
    dev_up: f64,
    dev_dn: f64,
) -> Result<[Series; 3], TaError> {
    run(input, |end, inp, beg, n, [u, m, l]| {
        // SAFETY: as in `sma`, for three outputs.
        unsafe {
            ffi::TA_BBANDS(
                0,
                end,
                inp,
                period,
                dev_up,
                dev_dn,
                ffi::TA_MATYPE_SMA,
                beg,
                n,
                u,
                m,
                l,
            )
        }
    })
}

/// MACD: `(macd, signal, histogram)`.
pub fn macd(input: &[f64], fast: i32, slow: i32, signal: i32) -> Result<[Series; 3], TaError> {
    run(input, |end, inp, beg, n, [m, s, h]| {
        // SAFETY: as in `sma`, for three outputs.
        unsafe { ffi::TA_MACD(0, end, inp, fast, slow, signal, beg, n, m, s, h) }
    })
}

/// Relative strength index (Wilder smoothing).
pub fn rsi(input: &[f64], period: i32) -> Result<Series, TaError> {
    let [s] = run(input, |end, inp, beg, n, [out]| {
        // SAFETY: as in `sma`.
        unsafe { ffi::TA_RSI(0, end, inp, period, beg, n, out) }
    })?;
    Ok(s)
}
