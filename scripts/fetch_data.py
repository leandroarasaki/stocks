"""
Pulls daily price history for every ticker listed in data/tickers.json and
writes the result to data/data.json. Runs once a day from the GitHub Actions
workflow, but you can also run it locally with: python scripts/fetch_data.py

Main source: Yahoo Finance's public chart endpoint, which works for stocks,
ETFs, and crypto (as ETH-USD, BTC-USD, and so on) and tends to work fine from
cloud runners. Stooq is kept as a second attempt for stocks only, since
Stooq often blocks requests coming from cloud provider IP ranges, which is
exactly what a GitHub Actions runner is.
"""

import csv
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TICKERS_PATH = ROOT / "data" / "tickers.json"
OUTPUT_PATH = ROOT / "data" / "data.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/csv,*/*",
}


def http_get(url, retries=3, delay=3):
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as response:
                return response.read()
        except Exception as error:
            last_error = error
            time.sleep(delay)
    raise last_error


def fetch_from_yahoo(symbol):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?range=5y&interval=1d"
    )
    raw = http_get(url)
    payload = json.loads(raw)
    result_list = payload.get("chart", {}).get("result")
    if not result_list:
        return None

    result = result_list[0]
    timestamps = result.get("timestamp")
    if not timestamps:
        return None
    quote = result["indicators"]["quote"][0]

    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for i, ts in enumerate(timestamps):
        c = quote["close"][i]
        if c is None:
            continue
        dates.append(time.strftime("%Y-%m-%d", time.gmtime(ts)))
        opens.append(quote["open"][i])
        highs.append(quote["high"][i])
        lows.append(quote["low"][i])
        closes.append(c)
        vol = quote["volume"][i]
        volumes.append(vol if vol is not None else None)

    if not dates:
        return None
    return {
        "dates": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    }


def fetch_from_stooq(stock_symbol):
    stooq_symbol = f"{stock_symbol.lower()}.us"
    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
    raw = http_get(url).decode("utf-8")
    if "Date,Open,High,Low,Close" not in raw:
        return None
    reader = csv.DictReader(io.StringIO(raw))
    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for row in reader:
        try:
            dates.append(row["Date"])
            opens.append(float(row["Open"]))
            highs.append(float(row["High"]))
            lows.append(float(row["Low"]))
            closes.append(float(row["Close"]))
            volumes.append(float(row["Volume"]) if row.get("Volume") else None)
        except (ValueError, KeyError):
            continue
    if not dates:
        return None
    return {
        "dates": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    }


def build_stats(series):
    closes = series["close"]
    highs = series["high"]
    lows = series["low"]
    last_close = closes[-1]
    prev_close = closes[-2] if len(closes) > 1 else last_close
    change = last_close - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0
    window_52w = min(252, len(closes))
    return {
        "last_close": round(last_close, 4),
        "change": round(change, 4),
        "change_pct": round(change_pct, 2),
        "period_high": round(max(highs), 4),
        "period_low": round(min(lows), 4),
        "high_52w": round(max(highs[-window_52w:]), 4),
        "low_52w": round(min(lows[-window_52w:]), 4),
    }


def main():
    tickers = json.loads(TICKERS_PATH.read_text())
    result = {}
    failed = []

    for entry in tickers:
        symbol = entry["symbol"]
        series = None
        last_error = None

        try:
            series = fetch_from_yahoo(entry["yahoo"])
        except Exception as error:
            last_error = str(error)

        if not series and entry["type"] == "stock":
            try:
                series = fetch_from_stooq(symbol)
            except Exception as error:
                last_error = str(error)

        if not series:
            print(f"Failed to fetch {symbol}: {last_error}", file=sys.stderr)
            failed.append({"symbol": symbol, "reason": last_error or "no data returned"})
            continue

        result[symbol] = {
            "series": series,
            "stats": build_stats(series),
        }
        time.sleep(1)  # be polite to the free endpoints

    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tickers": result,
        "failed": failed,
    }

    OUTPUT_PATH.write_text(json.dumps(output, separators=(",", ":")))
    print(f"Wrote {len(result)} tickers, {len(failed)} failed: {failed}")


if __name__ == "__main__":
    main()
