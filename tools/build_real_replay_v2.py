import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

DAY = "2026-07-08"
DATA = Path(r"D:\FirstSignal_GCDT_Dataset") / DAY / "sim_input"
OUT = Path(r"C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\realReplayData.js")
RISK_FREE = 0.045


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price_delta(spot, strike, t_years, iv, kind):
    t = max(float(t_years), 1 / (365 * 24 * 3600))
    vol = min(max(float(iv), 0.08), 0.80)
    d1 = (math.log(spot / strike) + (RISK_FREE + 0.5 * vol * vol) * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    disc = math.exp(-RISK_FREE * t)
    if kind == "call":
        price = spot * norm_cdf(d1) - strike * disc * norm_cdf(d2)
        delta = norm_cdf(d1)
    else:
        price = strike * disc * norm_cdf(-d2) - spot * norm_cdf(-d1)
        delta = norm_cdf(d1) - 1
    return max(price, 0.01), delta


def load_market():
    market = pd.read_csv(DATA / "market_timeline.csv")
    market["captured_at"] = pd.to_datetime(market["captured_at"])
    out = {}
    minute_index = pd.date_range(f"{DAY} 09:30:00", f"{DAY} 16:15:00", freq="1min")
    for ticker in ("SPY", "SPX"):
        frame = market[(market["ticker"] == ticker) & (market["source"] == "gex_exposure")].copy()
        frame = frame[(frame["captured_at"].dt.second == 0) & (frame["captured_at"].dt.minute % 5 == 0)]
        frame = frame.sort_values("captured_at").drop_duplicates("captured_at", keep="last")
        frame = frame.set_index("captured_at")
        frame = frame.reindex(frame.index.union(minute_index)).sort_index()
        numeric = [
            "spot", "total_call_exposure", "total_put_exposure", "net_exposure",
            "call_dominance_pct", "max_abs_gamma_strike",
            "max_positive_strike", "max_negative_strike",
        ]
        frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
        frame[numeric] = frame[numeric].interpolate(method="time").ffill().bfill()
        out[ticker] = frame.loc[minute_index].reset_index(names="captured_at")
    return minute_index, out


def load_gex():
    gex = pd.read_csv(DATA / "gex_key_levels.csv")
    gex["captured_at"] = pd.to_datetime(gex["captured_at"])
    return gex.sort_values("captured_at")


def latest_levels(gex, ticker, ts, spot):
    rows = gex[(gex["ticker"] == ticker) & (gex["captured_at"] <= ts)]
    if rows.empty:
        return spot, spot + 5, spot - 5
    stamp = rows["captured_at"].max()
    rows = rows[rows["captured_at"] == stamp].copy()
    rows["net_exposure"] = pd.to_numeric(rows["net_exposure"], errors="coerce").fillna(0)
    rows["strike"] = pd.to_numeric(rows["strike"], errors="coerce")
    rows = rows.dropna(subset=["strike"])
    gamma_flip = float(rows.iloc[(rows["strike"] - spot).abs().argsort()[:1]]["strike"].iloc[0])
    call_wall = float(rows.loc[rows["net_exposure"].idxmax(), "strike"])
    put_wall = float(rows.loc[rows["net_exposure"].idxmin(), "strike"])
    return gamma_flip, call_wall, put_wall


def load_real_chain():
    chain = pd.read_csv(DATA / "options_focus.csv")
    chain["captured_at"] = pd.to_datetime(chain["captured_at"])
    chain = chain[(chain["underlying"] == "SPY") & (chain["expiration"].astype(str) == DAY)].copy()
    chain["mid"] = (pd.to_numeric(chain["bid"], errors="coerce") + pd.to_numeric(chain["ask"], errors="coerce")) / 2
    chain["spread"] = pd.to_numeric(chain["ask"], errors="coerce") - pd.to_numeric(chain["bid"], errors="coerce")
    chain["iv"] = pd.to_numeric(chain["iv"], errors="coerce")
    chain = chain.dropna(subset=["strike", "bid", "ask", "iv", "mid"])
    return chain.sort_values("captured_at")


def quote_rows_from_real(current, spot):
    rows = []
    current = current[(current["strike"] - spot).abs() <= 10]
    for _, q in current.iterrows():
        rows.append({
            "contract": str(q["contract"]),
            "strike": float(q["strike"]),
            "side": "CALL" if str(q["type"]).lower() == "call" else "PUT",
            "bid": float(q["bid"]),
            "ask": float(q["ask"]),
            "mid": float(q["mid"]),
            "iv": float(q["iv"]),
            "delta": None,
            "quoteSource": "REAL",
        })
    return rows


def synth_rows(anchor, ts, spot):
    rows = []
    expiry = datetime.fromisoformat(f"{DAY}T16:15:00")
    t_years = max((expiry - ts.to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
    base = round(spot * 2) / 2
    strikes = [round(base + step * 0.5, 2) for step in range(-12, 13)]

    for kind in ("call", "put"):
        side_anchor = anchor[anchor["type"].str.lower() == kind].sort_values("strike")
        x = side_anchor["strike"].astype(float).to_numpy()
        ivs = side_anchor["iv"].astype(float).clip(0.10, 0.50).to_numpy()
        spreads = side_anchor["spread"].astype(float).clip(0.01, 0.25).to_numpy()
        if not len(x):
            continue
        for strike in strikes:
            iv = float(np.interp(strike, x, ivs))
            anchor_spread = float(np.interp(strike, x, spreads))
            fair, delta = bs_price_delta(spot, strike, t_years, iv, kind)
            spread = max(0.01, min(max(anchor_spread, fair * 0.04), 0.25))
            bid = max(fair - spread / 2, 0.01)
            ask = max(fair + spread / 2, bid + 0.01)
            side = "C" if kind == "call" else "P"
            expiry_code = pd.Timestamp(DAY).strftime("%y%m%d")
            contract = f"SPY{expiry_code}{side}{int(round(strike * 1000)):08d}"
            rows.append({
                "contract": contract,
                "strike": strike,
                "side": "CALL" if kind == "call" else "PUT",
                "bid": bid,
                "ask": ask,
                "mid": fair,
                "iv": iv,
                "delta": delta,
                "quoteSource": "SYNTHETIC_CALIBRATED",
            })
    return rows


def main():
    minute_index, market = load_market()
    gex = load_gex()
    real_chain = load_real_chain()
    first_real = real_chain["captured_at"].min()
    anchor = real_chain[real_chain["captured_at"] == first_real].copy()
    snapshots = []

    for i, ts in enumerate(minute_index):
        spy = market["SPY"].iloc[i]
        spx = market["SPX"].iloc[i]
        spot = float(spy["spot"])
        gamma_flip, call_wall, put_wall = latest_levels(gex, "SPY", ts, spot)

        if ts < first_real:
            chain_rows = synth_rows(anchor, ts, spot)
            quote_source = "SYNTHETIC_CALIBRATED"
        else:
            eligible = real_chain[real_chain["captured_at"] <= ts]
            stamp = eligible["captured_at"].max()
            current = eligible[eligible["captured_at"] == stamp]
            chain_rows = quote_rows_from_real(current, spot)
            quote_source = "REAL"

        iv_values = [q["iv"] for q in chain_rows if q.get("iv") is not None]
        snapshots.append({
            "time": ts.strftime("%H:%M"),
            "spySpot": spot,
            "spxSpot": float(spx["spot"]),
            "netGex": float(spy["net_exposure"]),
            "netGexSpx": float(spx["net_exposure"]),
            "callDom": float(spy["call_dominance_pct"]) / 100.0,
            "callDomSpx": float(spx["call_dominance_pct"]) / 100.0,
            "gammaFlip": gamma_flip,
            "callWall": call_wall,
            "putWall": put_wall,
            "iv": float(np.median(iv_values)) if iv_values else 0.20,
            "quoteSource": quote_source,
            "chain": chain_rows,
        })

    payload = {
        "date": DAY,
        "label": "Jul 8 · Native SPY/SPX · 1-minute replay",
        "dayType": "REAL DATA REPLAY",
        "snapshots": snapshots,
    }
    OUT.write_text("export const REAL_REPLAY_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(OUT, len(snapshots), sum(len(x["chain"]) for x in snapshots))


if __name__ == "__main__":
    main()
