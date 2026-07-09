import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

DAYS = ["2026-07-06", "2026-07-07", "2026-07-08"]
ROOT = Path(r"D:\FirstSignal_GCDT_Dataset")
OUT = Path(r"C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\realReplayData.js")
RISK_FREE = 0.045
DAY = DAYS[-1]
DATA = ROOT / DAY / "sim_input"


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price_delta(spot, strike, t_years, iv, kind):
    t = max(float(t_years), 1 / (365 * 24 * 3600))
    vol = min(max(float(iv), 0.08), 0.80)
    d1 = (math.log(spot / strike) + (RISK_FREE + 0.5 * vol * vol) * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    disc = math.exp(-RISK_FREE * t)
    if kind == "call":
        return max(spot * norm_cdf(d1) - strike * disc * norm_cdf(d2), 0.01), norm_cdf(d1)
    return max(strike * disc * norm_cdf(-d2) - spot * norm_cdf(-d1), 0.01), norm_cdf(d1) - 1


def load_market():
    market = pd.read_csv(DATA / "market_timeline.csv")
    market["captured_at"] = pd.to_datetime(market["captured_at"])
    minute_index = pd.date_range(f"{DAY} 09:30:00", f"{DAY} 16:15:00", freq="1min")
    out = {}
    for ticker in ("SPY", "SPX"):
        frame = market[(market["ticker"] == ticker) & (market["source"].isin(["gex_exposure", "spot", "market_context"]))].copy()
        priority = {"gex_exposure": 0, "spot": 1, "market_context": 2}
        frame["_priority"] = frame["source"].map(priority).fillna(9)
        frame = frame.sort_values(["captured_at", "_priority"]).drop_duplicates("captured_at", keep="first")
        frame = frame.set_index("captured_at")
        numeric = ["spot", "total_call_exposure", "total_put_exposure", "net_exposure", "call_dominance_pct", "max_abs_gamma_strike", "max_positive_strike", "max_negative_strike"]
        for col in numeric:
            if col not in frame:
                frame[col] = np.nan
        frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
        frame = frame.reindex(frame.index.union(minute_index)).sort_index()
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
        return spot, spot + 5, spot - 5, "MISSING_GEX_LEVELS"
    stamp = rows["captured_at"].max()
    rows = rows[rows["captured_at"] == stamp].copy()
    rows["net_exposure"] = pd.to_numeric(rows["net_exposure"], errors="coerce").fillna(0)
    rows["strike"] = pd.to_numeric(rows["strike"], errors="coerce")
    rows = rows.dropna(subset=["strike"])
    levels = rows.groupby("strike", as_index=False)["net_exposure"].sum().sort_values("strike")
    vals = levels[["strike", "net_exposure"]].to_numpy(float)
    crossings = []
    for i in range(1, len(vals)):
        x0, y0 = vals[i - 1]
        x1, y1 = vals[i]
        if y0 == 0:
            crossings.append(x0)
        elif y0 * y1 < 0:
            crossings.append(x0 + (x1 - x0) * (-y0) / (y1 - y0))
    gamma_flip = float(min(crossings, key=lambda x: abs(x - spot))) if crossings else float(levels.loc[levels["net_exposure"].abs().idxmin(), "strike"])
    return gamma_flip, float(levels.loc[levels["net_exposure"].idxmax(), "strike"]), float(levels.loc[levels["net_exposure"].idxmin(), "strike"]), "STRIKE_GEX_ZERO_CROSSING" if crossings else "NEAREST_ZERO_GEX_STRIKE"


def read_chain(day):
    path = ROOT / day / "sim_input" / "options_focus.csv"
    if not path.exists():
        return pd.DataFrame()
    chain = pd.read_csv(path)
    if chain.empty:
        return chain
    chain["captured_at"] = pd.to_datetime(chain["captured_at"])
    chain = chain[(chain["underlying"] == "SPY") & (chain["expiration"].astype(str) == day)].copy()
    if chain.empty:
        return chain
    chain["mid"] = (pd.to_numeric(chain["bid"], errors="coerce") + pd.to_numeric(chain["ask"], errors="coerce")) / 2
    chain["spread"] = pd.to_numeric(chain["ask"], errors="coerce") - pd.to_numeric(chain["bid"], errors="coerce")
    chain["iv"] = pd.to_numeric(chain["iv"], errors="coerce")
    return chain.dropna(subset=["strike", "bid", "ask", "iv", "mid"]).sort_values("captured_at")


def calibration_anchor(day, same_day_chain):
    if not same_day_chain.empty:
        first = same_day_chain["captured_at"].min()
        return day, same_day_chain[same_day_chain["captured_at"] == first].copy()
    choices = []
    for candidate in DAYS:
        frame = read_chain(candidate)
        if not frame.empty:
            first = frame["captured_at"].min()
            choices.append((abs((pd.Timestamp(candidate) - pd.Timestamp(day)).days), candidate, frame[frame["captured_at"] == first].copy()))
    if not choices:
        raise RuntimeError(f"No SPY option calibration chain available for {day}")
    choices.sort(key=lambda x: (x[0], x[1]))
    return choices[0][1], choices[0][2]


def quote_rows_from_real(current, spot):
    rows = []
    for _, q in current[(current["strike"] - spot).abs() <= 10].iterrows():
        rows.append({"contract": str(q["contract"]), "strike": float(q["strike"]), "side": "CALL" if str(q["type"]).lower() == "call" else "PUT", "bid": float(q["bid"]), "ask": float(q["ask"]), "mid": float(q["mid"]), "iv": float(q["iv"]), "delta": None, "quoteSource": "REAL"})
    return rows


def synth_rows(anchor, ts, spot, quote_source):
    rows = []
    expiry = datetime.fromisoformat(f"{DAY}T16:15:00")
    t_years = max((expiry - ts.to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
    base = round(spot * 2) / 2
    for kind in ("call", "put"):
        side_anchor = anchor[anchor["type"].str.lower() == kind].sort_values("strike")
        x = side_anchor["strike"].astype(float).to_numpy()
        if not len(x):
            continue
        ivs = side_anchor["iv"].astype(float).clip(0.10, 0.50).to_numpy()
        spreads = side_anchor["spread"].astype(float).clip(0.01, 0.25).to_numpy()
        for strike in [round(base + step * 0.5, 2) for step in range(-12, 13)]:
            iv = float(np.interp(strike, x, ivs))
            fair, delta = bs_price_delta(spot, strike, t_years, iv, kind)
            spread = max(0.01, min(max(float(np.interp(strike, x, spreads)), fair * 0.04), 0.25))
            bid = max(fair - spread / 2, 0.01)
            ask = max(fair + spread / 2, bid + 0.01)
            side = "C" if kind == "call" else "P"
            contract = f"SPY{pd.Timestamp(DAY).strftime('%y%m%d')}{side}{int(round(strike * 1000)):08d}"
            rows.append({"contract": contract, "strike": strike, "side": "CALL" if kind == "call" else "PUT", "bid": bid, "ask": ask, "mid": fair, "iv": iv, "delta": delta, "quoteSource": quote_source})
    return rows


def build_day(day):
    global DAY, DATA
    DAY = day
    DATA = ROOT / DAY / "sim_input"
    minute_index, market = load_market()
    gex = load_gex()
    real_chain = read_chain(DAY)
    calibration_day, anchor = calibration_anchor(DAY, real_chain)
    has_real = not real_chain.empty
    first_real = real_chain["captured_at"].min() if has_real else None
    snapshots = []
    for i, ts in enumerate(minute_index):
        spy, spx = market["SPY"].iloc[i], market["SPX"].iloc[i]
        spot = float(spy["spot"])
        gamma_flip, call_wall, put_wall, fep_source = latest_levels(gex, "SPY", ts, spot)
        if has_real and ts >= first_real:
            eligible = real_chain[real_chain["captured_at"] <= ts]
            stamp = eligible["captured_at"].max()
            chain_rows = quote_rows_from_real(eligible[eligible["captured_at"] == stamp], spot)
            quote_source = "REAL"
        else:
            quote_source = "SYNTHETIC_CALIBRATED" if has_real else "SYNTHETIC_CROSS_DAY_CALIBRATED"
            chain_rows = synth_rows(anchor, ts, spot, quote_source)
        iv_values = [q["iv"] for q in chain_rows if q.get("iv") is not None]
        snapshots.append({"time": ts.strftime("%H:%M"), "spySpot": spot, "spxSpot": float(spx["spot"]), "netGex": float(spy["net_exposure"]), "netGexSpx": float(spx["net_exposure"]), "callDom": float(spy["call_dominance_pct"]) / 100.0, "callDomSpx": float(spx["call_dominance_pct"]) / 100.0, "gammaFlip": gamma_flip, "callWall": call_wall, "putWall": put_wall, "iv": float(np.median(iv_values)) if iv_values else 0.20, "quoteSource": quote_source, "calibrationSourceDay": DAY if has_real else calibration_day, "marketSource": "NATIVE_OBSERVED_PLUS_TIME_INTERPOLATION", "fepSource": fep_source, "chain": chain_rows})
    return {"date": DAY, "label": f"{DAY} Â· Unified native SPY/SPX Â· 1-minute replay", "dayType": "REAL DATA REPLAY", "coverage": {"realChainStart": first_real.strftime("%H:%M") if has_real else None, "optionCalibrationDay": DAY if has_real else calibration_day}, "snapshots": snapshots}


def main():
    catalog = {day: build_day(day) for day in DAYS}
    OUT.write_text("export const REAL_REPLAY_CATALOG = " + json.dumps(catalog, separators=(",", ":")) + ";\n", encoding="utf-8")
    for day, payload in catalog.items():
        counts = pd.Series([x["quoteSource"] for x in payload["snapshots"]]).value_counts().to_dict()
        print(day, len(payload["snapshots"]), counts, payload["coverage"])


if __name__ == "__main__":
    main()
