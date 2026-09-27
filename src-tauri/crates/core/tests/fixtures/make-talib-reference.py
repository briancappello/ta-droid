"""Regenerate talibSameInput.json with fa-techan's own TA-Lib.

Run with fa-techan's environment (Python ta-lib 0.6.8 on TA-Lib C 0.6.4):
    ~/dev/fa-techan/.venv/bin/python make-talib-reference.py

faTechanHistory.json was computed by fa-techan over a longer history than its
400 rows, so EMA-seeded columns (MACD, RSI) cannot match a 400-row
computation exactly. This reference uses exactly the fixture's closes and
fa-techan's calls (history.py:49-57), so every column must match to float
precision.
"""

import json
import math
import pathlib

import numpy as np
import talib

here = pathlib.Path(__file__).parent
fx = json.loads((here / "faTechanHistory.json").read_text())
close = np.array([row[fx["columns"].index("close")] for row in fx["data"]], dtype=float)

upper, middle, lower = talib.BBANDS(close, timeperiod=20)
macd, signal, hist = talib.MACD(close)
cols = {
    "sma20": middle,
    "sma100": talib.SMA(close, timeperiod=100),
    "sma200": talib.SMA(close, timeperiod=200),
    "bbands_upper": upper,
    "bbands_lower": lower,
    "macd": macd,
    "macd_signal": signal,
    "macd_difference": hist,
    "rsi": talib.RSI(close),
}
out = {
    "talib": talib.__ta_version__.decode().split(" ")[0],
    "python_talib": talib.__version__,
    "columns": list(cols),
    "data": [[None if math.isnan(v[i]) else float(v[i]) for v in cols.values()] for i in range(len(close))],
}
(here / "talibSameInput.json").write_text(json.dumps(out) + "\n")
