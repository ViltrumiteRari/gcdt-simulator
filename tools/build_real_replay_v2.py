import json
import math
import tarfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

DAYS = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]
SOURCE_INTERVAL_SECONDS = {"2026-07-13":300,"2026-07-14":300,"2026-07-15":20,"2026-07-16":20,"2026-07-17":20,"2026-07-20":20,"2026-07-21":20,"2026-07-22":20}
ROOT = Path(r"D:\FirstSignal_Sim_Dataset")
OUT = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")
OUT_JUL10 = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayDataJul10.js")
FALLBACK_CATALOG = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\replayCatalog.js")
RISK_FREE = 0.045
DAY = DAYS[-1]
DATA = ROOT / DAY / "sim_input"


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price_delta(spot, strike, t_years, iv, kind):
    t = max(float(t_years), 1 / (365 * 24 * 3600))
    vol = min(max(float(iv), 0.08), 3.00)
    d1 = (math.log(spot / strike) + (RISK_FREE + 0.5 * vol * vol) * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    disc = math.exp(-RISK_FREE * t)
    if kind == "call":
        return max(spot * norm_cdf(d1) - strike * disc * norm_cdf(d2), 0.01), norm_cdf(d1)
    return max(strike * disc * norm_cdf(-d2) - spot * norm_cdf(-d1), 0.01), norm_cdf(d1) - 1


def implied_vol_delta(spot, strike, t_years, price, kind):
    intrinsic = max(spot - strike, 0) if kind == "call" else max(strike - spot, 0)
    target = max(float(price), intrinsic + 0.001)
    lo, hi = 0.01, 5.00
    for _ in range(60):
        mid = (lo + hi) / 2
        value, _ = bs_price_delta(spot, strike, t_years, mid, kind)
        if value < target:
            lo = mid
        else:
            hi = mid
    iv = (lo + hi) / 2
    _, delta = bs_price_delta(spot, strike, t_years, iv, kind)
    return iv, delta




def causal_project_series(series, target_index, slope_cap=None, max_age_minutes=None):
    """Project onto target timestamps using observations available at or before each target only."""
    src = pd.to_numeric(series, errors="coerce").dropna().sort_index()
    if src.empty:
        return pd.Series(index=target_index, dtype=float), pd.Series(index=target_index, dtype=float)
    src = src[~src.index.duplicated(keep="last")]
    times = src.index.view("int64")
    values = src.to_numpy(float)
    out, ages = [], []
    for ts in target_index:
        pos = int(np.searchsorted(times, ts.value, side="right") - 1)
        if pos < 0:
            out.append(np.nan); ages.append(np.nan); continue
        age = (ts.value - times[pos]) / 60_000_000_000
        if max_age_minutes is not None and age > max_age_minutes:
            out.append(np.nan); ages.append(age); continue
        value = values[pos]
        if pos >= 1 and age > 0:
            dt = max((times[pos] - times[pos-1]) / 60_000_000_000, 1e-9)
            slope = (values[pos] - values[pos-1]) / dt
            if slope_cap is not None:
                slope = float(np.clip(slope, -slope_cap, slope_cap))
            value = value + slope * age * math.exp(-age / 3.0)
        out.append(float(value)); ages.append(float(age))
    return pd.Series(out, index=target_index), pd.Series(ages, index=target_index)


def causal_ffill_frame(frame, columns, target_index):
    base = frame[columns].copy().sort_index()
    merged = base.reindex(base.index.union(target_index)).sort_index().ffill()
    return merged.reindex(target_index)

def load_market():
    market = pd.read_csv(DATA / "market_timeline.csv")
    market["captured_at"] = pd.to_datetime(market["captured_at"].astype(str).str.slice(0,19), errors="coerce")
    minute_index = pd.date_range(f"{DAY} 09:30:00", f"{DAY} 16:15:00", freq="20s")
    out = {}
    first_native_spot = {}
    for ticker in ("SPY", "SPX"):
        frame = market[(market["ticker"] == ticker) & (market["source"].isin(["gexstream_native_20s", "gex_exposure", "spot", "market_context"]))].copy()
        native_spot_rows = frame[pd.to_numeric(frame["spot"], errors="coerce").notna()]
        first_native_spot[ticker] = native_spot_rows["captured_at"].min() if not native_spot_rows.empty else None
        priority = {"gexstream_native_20s": 0, "gex_exposure": 1, "spot": 2, "market_context": 3}
        frame["_priority"] = frame["source"].map(priority).fillna(9)
        frame = frame.sort_values(["captured_at", "_priority"]).drop_duplicates("captured_at", keep="first")
        # Reject stale intraminute spot injections when reliable 5-minute anchors exist.
        # These can otherwise create impossible multi-dollar sawteeth in the replay chart.
        spot_num = pd.to_numeric(frame["spot"], errors="coerce")
        anchor_mask = (frame["captured_at"].dt.second == 0) & (frame["captured_at"].dt.minute % 5 == 0) & spot_num.notna()
        anchors = frame.loc[anchor_mask, ["captured_at"]].copy()
        anchors["anchor_spot"] = spot_num.loc[anchor_mask].to_numpy()
        if len(anchors) >= 2 and SOURCE_INTERVAL_SECONDS.get(DAY, 300) >= 60:
            anchor_series = anchors.set_index("captured_at")["anchor_spot"]
            full_index = frame["captured_at"]
            expected, _ = causal_project_series(anchor_series, pd.DatetimeIndex(full_index), slope_cap=5.0 if ticker == "SPX" else 0.5)
            expected = expected.to_numpy()
            stale = spot_num.notna() & np.isfinite(expected) & ((spot_num.to_numpy() - expected).astype(float).__abs__() > 1.50)
            frame.loc[stale, "spot"] = np.nan
        frame = frame.set_index("captured_at")
        numeric = ["spot", "total_call_exposure", "total_put_exposure", "net_exposure", "call_dominance_pct", "max_abs_gamma_strike", "max_positive_strike", "max_negative_strike"]
        for col in numeric:
            if col not in frame:
                frame[col] = np.nan
        frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
        frame = frame.reindex(frame.index.union(minute_index)).sort_index()
        frame[numeric] = causal_ffill_frame(frame, numeric, minute_index)
        out[ticker] = frame.loc[minute_index].reset_index(names="captured_at")

    # Repair impossible exact-flat SPX runs without using future SPX observations.
    # Preserve each run's first SPX anchor and transmit contemporaneous SPY returns until
    # native SPX begins changing again. This is causal at every replay tick.
    spx_values = pd.to_numeric(out["SPX"]["spot"], errors="coerce").copy()
    spy_values = pd.to_numeric(out["SPY"]["spot"], errors="coerce").copy()
    out["SPX"]["spot_repair"] = "NATIVE"
    i = 0
    while i < len(spx_values):
        j = i + 1
        while j < len(spx_values) and np.isfinite(spx_values.iloc[j]) and np.isfinite(spx_values.iloc[i]) and abs(float(spx_values.iloc[j])-float(spx_values.iloc[i])) < 1e-9:
            j += 1
        run_len = j - i
        if run_len >= 30 and np.isfinite(spy_values.iloc[i]) and spy_values.iloc[i] != 0 and spy_values.iloc[i:j].nunique(dropna=True) >= 8:
            anchor_spx = float(spx_values.iloc[i]); anchor_spy = float(spy_values.iloc[i])
            spy_return = spy_values.iloc[i:j] / anchor_spy - 1.0
            spy_gex = pd.to_numeric(out["SPY"]["net_exposure"], errors="coerce")
            spx_gex = pd.to_numeric(out["SPX"]["net_exposure"], errors="coerce")
            spy_scale = spy_gex.abs().expanding(min_periods=1).median().replace(0, np.nan).ffill().fillna(1.0)
            spx_scale = spx_gex.abs().expanding(min_periods=1).median().replace(0, np.nan).ffill().fillna(1.0)
            spy_regime = np.tanh(spy_gex.iloc[i:j] / spy_scale.iloc[i:j])
            spx_regime = np.tanh(spx_gex.iloc[i:j] / spx_scale.iloc[i:j])
            gex_divergence = ((spy_regime - spx_regime).abs() / 2.0).clip(0.0, 1.0)
            gex_damping = (1.0 - 0.30 * gex_divergence).clip(0.70, 1.0)
            derived = anchor_spx * (1.0 + spy_return * gex_damping)
            out["SPX"].loc[i:j-1, "spot"] = derived.to_numpy()
            out["SPX"].loc[i:j-1, "spot_repair"] = "CAUSAL_SPY_RETURN_GEX_DAMPED_BRIDGE"
            spx_values.iloc[i:j] = derived.to_numpy()
        i = j

    # Repair stale captured spot values with the independent option-chain underlying path.
    # July 9's GEX/spot endpoint repeated one stale spot after noon even while the chain's
    # underlying field continued updating. Prefer the chain path for price only; keep GEX
    # and call-dominance from their native exposure feeds.
    focus_path = DATA / "options_focus.csv"
    if focus_path.exists():
        focus = pd.read_csv(focus_path)
        focus["captured_at"] = pd.to_datetime(focus["captured_at"].astype(str).str.slice(0,19), errors="coerce")
        for ticker, underlying in (("SPY", "SPY"), ("SPX", "^SPX")):
            fx = focus[focus["underlying"] == underlying].copy()
            if fx.empty:
                continue
            fx["spot"] = pd.to_numeric(fx["spot"], errors="coerce")
            series = fx.dropna(subset=["spot"]).groupby("captured_at")["spot"].median().sort_index()
            if series.empty:
                continue
            # Some option feeds carry a stale premarket underlying into the open.
            # Do not let that overwrite a changing native spot path until the option
            # underlying itself has made a meaningful observed move.
            moves = series.diff().abs()
            active = moves[moves > 0.01]
            if active.empty:
                continue
            first_active = active.index[0]
            series, _ = causal_project_series(series, minute_index, slope_cap=5.0 if ticker == "SPX" else 0.5, max_age_minutes=10)
            start = first_active.floor("min")
            mask = (out[ticker]["captured_at"] >= start).to_numpy() & series.notna().to_numpy()
            out[ticker].loc[mask, "spot"] = series.loc[mask].to_numpy()
    # If native SPX collection starts late, restore the earlier five-minute historical path
    # from the legacy catalog and interpolate it to one-minute resolution.
    first_spx = first_native_spot.get("SPX")
    if first_spx is not None and first_spx > minute_index[0] and FALLBACK_CATALOG.exists():
        raw = FALLBACK_CATALOG.read_text(encoding="utf-8")
        catalog_json = raw.split("=", 1)[1].split(";\nexport const REPLAY_DATES", 1)[0].strip()
        payload = json.loads(catalog_json)
        legacy = payload.get(DAY, {}).get("snapshots", [])
        if legacy:
            legacy_index = pd.to_datetime([f"{DAY} {row['time']}:00" for row in legacy])
            legacy_spx = pd.Series([float(row["spot"]) for row in legacy], index=legacy_index)
            legacy_spx, _ = causal_project_series(legacy_spx, minute_index, slope_cap=5.0, max_age_minutes=15)
            anchor_idx = int(np.searchsorted(minute_index.values, np.datetime64(first_spx), side="left"))
            anchor_idx = min(max(anchor_idx, 0), len(minute_index) - 1)
            pre_mask = out["SPX"]["captured_at"] < first_spx
            out["SPX"].loc[pre_mask, "spot"] = legacy_spx.loc[pre_mask.to_numpy()].to_numpy()
    # Never reconstruct pre-observation SPY values from a future anchor.
    return minute_index, out


def load_dedicated_spot(day, ticker, minute_index):
    path = ROOT / day / ticker / "spot" / "spot_intraday_5m.csv"
    if not path.exists():
        return None
    frame = pd.read_csv(path)
    if frame.empty or "timestamp_local" not in frame or "spot" not in frame:
        return None
    frame["captured_at"] = pd.to_datetime(frame["timestamp_local"], format="mixed", errors="coerce")
    frame["spot"] = pd.to_numeric(frame["spot"], errors="coerce")
    frame = frame.dropna(subset=["captured_at", "spot"]).sort_values("captured_at").drop_duplicates("captured_at", keep="last")
    if frame.empty:
        return None
    series = frame.set_index("captured_at")["spot"]
    projected, _ = causal_project_series(series, minute_index, slope_cap=5.0 if ticker == "SPX" else 0.5, max_age_minutes=20)
    return projected


def load_gex():
    gex = pd.read_csv(DATA / "gex_key_levels.csv")
    gex["captured_at"] = pd.to_datetime(gex["captured_at"].astype(str).str.slice(0,19), errors="coerce")
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
    # Normalize isolated SPX-style strike scaling accidentally mixed into SPY data.
    if ticker == "SPY":
        for _ in range(2):
            bad = rows["strike"] > max(1500.0, spot * 3.0)
            rows.loc[bad, "strike"] = rows.loc[bad, "strike"] / 10.0
        rows = rows[(rows["strike"] >= spot - 40) & (rows["strike"] <= spot + 40)]
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
    # Walls are side-specific concentration levels, not unrestricted extrema.
    # Prefer positive exposure at/above spot for the call wall and negative exposure
    # at/below spot for the put wall. This prevents semantically inverted walls.
    calls = levels[(levels["strike"] >= spot) & (levels["net_exposure"] > 0)]
    puts = levels[(levels["strike"] <= spot) & (levels["net_exposure"] < 0)]
    call_wall = float(calls.loc[calls["net_exposure"].idxmax(), "strike"]) if not calls.empty else float(levels.loc[levels["net_exposure"].idxmax(), "strike"])
    put_wall = float(puts.loc[puts["net_exposure"].idxmin(), "strike"]) if not puts.empty else float(levels.loc[levels["net_exposure"].idxmin(), "strike"])
    if call_wall < put_wall:
        call_wall = float(levels[levels["strike"] >= spot]["strike"].min()) if not levels[levels["strike"] >= spot].empty else float(math.ceil(spot))
        put_wall = float(levels[levels["strike"] <= spot]["strike"].max()) if not levels[levels["strike"] <= spot].empty else float(math.floor(spot))
    return gamma_flip, call_wall, put_wall, "STRIKE_GEX_ZERO_CROSSING" if crossings else "NEAREST_ZERO_GEX_STRIKE"


def repair_reference_walls(day, snapshots):
    if day != "2026-07-15":
        for x in snapshots:
            x["wallSource"] = "FULL_STRIKE_NET_GEX"
            x["wallConfidence"] = "HIGH" if day == "2026-07-16" else "NATIVE_INTERVAL"
        return snapshots
    p = ROOT / day / "SPY" / "exposure" / "strike_exposure_long.csv"
    if not p.exists(): return snapshots
    rich = pd.read_csv(p); rich["captured_at"] = pd.to_datetime(rich["captured_at"], errors="coerce")
    for c in ("strike","call_exposure","put_exposure","spot"):
        rich[c] = pd.to_numeric(rich[c], errors="coerce")
    rich = rich.dropna(subset=["captured_at","strike","spot"])
    bad = rich["strike"] > rich["spot"] * 3; rich.loc[bad,"strike"] /= 10
    refs=[]
    for ts,g in rich.groupby("captured_at"):
        refs.append((ts,float(g.loc[g.call_exposure.idxmax(),"strike"]),float(g.loc[g.put_exposure.idxmin(),"strike"])))
    if not refs: return snapshots
    ref=pd.DataFrame(refs,columns=["ts","call","put"]).sort_values("ts")
    call_modes=list(ref.call.value_counts().index[:4]); put_modes=list(ref.put.value_counts().index[:4])
    for x in snapshots:
        ts=pd.Timestamp(f'{day} {x["time"]}'); prior=ref[ref.ts<=ts]
        if not prior.empty:
            call=float(prior.iloc[-1].call); put=float(prior.iloc[-1].put); source="RICH_STRIKE_SURFACE_CAUSAL"
        else: call=call_modes[0]; put=put_modes[0]; source="RICH_STRIKE_SURFACE_REFERENCE"
        if ts>ref.ts.max():
            above=[v for v in call_modes if v>=x["spySpot"]+0.20]; call=min(above) if above else max(call_modes)
            below=[v for v in put_modes if v<=x["spySpot"]-0.20]; put=max(below) if below else min(put_modes)
            source="EARLY_RICH_SURFACE_REFERENCE"
        x["callWall"],x["putWall"]=float(call),float(put)
        x["wallSource"],x["wallConfidence"]=source,"HIGH" if ts<=ref.ts.max() else "MEDIUM"
    return snapshots

def read_trade_history(day):
    base = ROOT / day / "options_historical_quantdata" / "contract_price_time"
    candidates = [
        base / "regular_0930_1615_contract_ohlcv.csv",
        base / "regular_0930_1615_contract_ohlcv.csv.gz",
        base / "morning_0930_1200_contract_ohlcv.csv",
        base / "morning_0930_1200_contract_ohlcv.csv.gz",
        # Historical backfill originally used this misleading filename for the full-day file.
        base / "morning_contract_ohlcv.csv",
        base / "morning_contract_ohlcv.csv.gz",
        base / "intraday_contract_ohlcv.csv",
        base / "intraday_contract_ohlcv.csv.gz",
    ]
    frames = []
    for path in candidates:
        if path.exists():
            try:
                frame = pd.read_csv(path)
                if not frame.empty:
                    frames.append(frame)
            except Exception:
                pass
    if not frames:
        return pd.DataFrame()
    frame = pd.concat(frames, ignore_index=True).drop_duplicates()
    frame["captured_at"] = pd.to_datetime(frame["captured_at"], format="mixed", errors="coerce")
    frame = frame[(frame["ticker"] == "SPY") & (frame["expiration"].astype(str) == day)].copy()
    for col in ["strike", "open", "high", "low", "close", "volume", "underlying_close"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame.dropna(subset=["captured_at", "strike", "close", "underlying_close"]).sort_values("captured_at")


def read_chain(day):
    path = ROOT / day / "sim_input" / "options_focus.csv"
    if not path.exists():
        return pd.DataFrame()
    chain = pd.read_csv(path)
    if chain.empty:
        return chain
    chain["captured_at"] = pd.to_datetime(chain["captured_at"].astype(str).str.slice(0,19), errors="coerce")
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
        rows.append({"contract": str(q["contract"]), "strike": float(q["strike"]), "side": "CALL" if str(q["type"]).lower() == "call" else "PUT", "bid": float(q["bid"]), "ask": float(q["ask"]), "mid": float(q["mid"]), "iv": float(q["iv"]), "delta": None, "volume": int(float(q.get("volume", 0) or 0)), "openInterest": int(float(q.get("open_interest", 0) or 0)), "quoteSource": "REAL_QUOTE"})
    return rows


def rows_from_trade_history(current, ts, spot, quote_source="REAL_TRADE_OHLCV"):
    rows = []
    expiry = datetime.fromisoformat(f"{DAY}T16:15:00")
    t_years = max((expiry - ts.to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
    for _, q in current[(current["strike"] - spot).abs() <= 10].iterrows():
        kind = "call" if str(q["side"]).upper() == "CALL" else "put"
        mark = max(float(q["close"]), 0.01)
        iv, delta = implied_vol_delta(spot, float(q["strike"]), t_years, mark, kind)
        side = "C" if kind == "call" else "P"
        contract = f"SPY{pd.Timestamp(DAY).strftime('%y%m%d')}{side}{int(round(float(q['strike']) * 1000)):08d}"
        rows.append({
            "contract": contract, "strike": float(q["strike"]), "side": kind.upper(),
            "bid": round(mark, 4), "ask": round(mark, 4), "mid": round(mark, 4),
            "iv": round(iv, 5), "delta": round(delta, 5),
            "quoteSource": quote_source
        })
    return rows


def path_fill_rows(history, ts, spot, forward_limit=15):
    """Causal option reconstruction using only contract observations at or before ts."""
    expiry = datetime.fromisoformat(f"{DAY}T16:15:00")
    target_t = max((expiry - ts.to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
    rows = []
    nearby = history[(history["strike"] - spot).abs() <= 10]
    for (strike, side), group in nearby.groupby(["strike", "side"]):
        prev = group[group["captured_at"] <= ts].sort_values("captured_at").tail(2)
        if prev.empty:
            continue
        p = prev.iloc[-1]
        age = (ts - p["captured_at"]).total_seconds() / 60
        if age > forward_limit:
            continue
        kind = "call" if str(side).upper() == "CALL" else "put"
        pt = max((expiry - p["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
        piv, _ = implied_vol_delta(float(p["underlying_close"]), float(strike), pt, float(p["close"]), kind)
        slope = 0.0
        if len(prev) == 2:
            p0 = prev.iloc[0]
            p0t = max((expiry - p0["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
            p0iv, _ = implied_vol_delta(float(p0["underlying_close"]), float(strike), p0t, float(p0["close"]), kind)
            mins = max((p["captured_at"] - p0["captured_at"]).total_seconds() / 60, 1)
            slope = float(np.clip((math.log(max(piv, 0.01)) - math.log(max(p0iv, 0.01))) / mins, -0.08, 0.08))
        iv = math.exp(math.log(max(piv, 0.01)) + slope * age * math.exp(-age / 5))
        price, delta = bs_price_delta(spot, float(strike), target_t, iv, kind)
        rows.append({"contract": str(p.get("contract", f"{DAY}:{side}:{strike}")), "strike": float(strike), "side": str(side).upper(), "bid": max(0.01, round(price - 0.01, 2)), "ask": max(0.02, round(price + 0.01, 2)), "mid": round(price, 2), "iv": float(iv), "delta": float(delta), "volume": int(float(p.get("volume", 0) or 0)), "openInterest": int(float(p.get("open_interest", 0) or 0)), "quoteSource": "SYNTHETIC_PATH_CAUSAL_FORWARD", "sourceTimestamp": p["captured_at"].isoformat(), "sourceAgeMinutes": float(age)})
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


def load_order_flow(day):
    archive = ROOT / day / "SPY" / "order_flow" / "raw.tar.gz"
    latest = ROOT / day / "SPY" / "order_flow" / "latest_order_flow.json"
    records = {}
    payloads = []
    if archive.exists():
        with tarfile.open(archive, "r:gz") as tf:
            for member in tf.getmembers():
                if not member.isfile() or not member.name.endswith(".json"):
                    continue
                try:
                    payloads.append(json.load(tf.extractfile(member)))
                except Exception:
                    pass
    else:
        raw_dir = ROOT / day / "SPY" / "order_flow" / "raw"
        if raw_dir.exists():
            for path in sorted(raw_dir.glob("*.json")):
                try:
                    payloads.append(json.loads(path.read_text(encoding="utf-8")))
                except Exception:
                    pass
        if latest.exists():
            try:
                payloads.append(json.loads(latest.read_text(encoding="utf-8")))
            except Exception:
                pass
    for payload in payloads:
        body = payload.get("response", payload)
        for trade in body.get("trades", []) or []:
            if trade.get("ticker") == "SPY" and trade.get("id"):
                records[trade["id"]] = trade
    if not records:
        return {}
    rows = []
    for t in records.values():
        dt = pd.to_datetime(t.get("tradeTime"), unit="ms", utc=True).tz_convert("America/New_York").tz_localize(None)
        premium = float(t.get("premiumInCents") or 0) / 100.0
        side = str(t.get("tradeSideCode") or "")
        ctype = str(t.get("contractType") or "")
        children = t.get("comprisingTrades") or []
        prices = {c.get("optionPriceInCents") for c in children if c.get("optionPriceInCents") is not None}
        rows.append({"minute":dt.floor("min"),"premium":premium,"size":float(t.get("size") or 0),"ask":premium if side in ("A","AA") else 0,"bid":premium if side in ("B","BB") else 0,"sweep":premium if t.get("tradeConsolidationType")=="SWEEP" else 0,"block":premium if t.get("tradeConsolidationType")=="BLOCK" else 0,"multi":premium if t.get("exchange")=="MULTIPLE" else 0,"callAsk":premium if ctype=="CALL" and side in ("A","AA") else 0,"putAsk":premium if ctype=="PUT" and side in ("A","AA") else 0,"callBid":premium if ctype=="CALL" and side in ("B","BB") else 0,"putBid":premium if ctype=="PUT" and side in ("B","BB") else 0,"levels":len(prices) or 1})
    frame = pd.DataFrame(rows)
    out = {}
    for minute,g in frame.groupby("minute"):
        out[minute] = {"tradeCount":int(len(g)),"totalPremium":float(g.premium.sum()),"askPremium":float(g.ask.sum()),"bidPremium":float(g.bid.sum()),"sweepPremium":float(g.sweep.sum()),"blockPremium":float(g.block.sum()),"multiExchangePremium":float(g.multi.sum()),"callAskPremium":float(g.callAsk.sum()),"putAskPremium":float(g.putAsk.sum()),"callBidPremium":float(g.callBid.sum()),"putBidPremium":float(g.putBid.sum()),"maxContracts":float(g["size"].max()),"maxPriceLevels":int(g.levels.max()),"clusteredLegs":int((g.premium>0).sum()>3),"oppositeSideNear":int(g.ask.sum()>0 and g.bid.sum()>0),"repeatedSameSide":int(max((g.ask>0).sum(),(g.bid>0).sum())>=3)}
    return out

def build_day(day):
    global DAY, DATA
    DAY = day
    DATA = ROOT / DAY / "sim_input"
    minute_index, market = load_market()
    gex = load_gex()
    trade_history = read_trade_history(DAY)
    real_chain = read_chain(DAY)
    order_flow = load_order_flow(DAY)
    has_trade_history = not trade_history.empty
    # Prefer the dedicated full-session spot captures. Contract-history files may be
    # intentionally limited to a morning window and must never be forward-filled into
    # a fake frozen afternoon. Fall back to contract underlying only when no dedicated path exists.
    dedicated_spy = load_dedicated_spot(DAY, "SPY", minute_index)
    dedicated_spx = load_dedicated_spot(DAY, "SPX", minute_index)
    if dedicated_spy is not None:
        valid = dedicated_spy.notna().to_numpy()
        market["SPY"].loc[valid, "spot"] = dedicated_spy.loc[valid].to_numpy()
    elif has_trade_history:
        synced = trade_history.groupby("captured_at")["underlying_close"].median().sort_index()
        synced, _ = causal_project_series(synced, minute_index, slope_cap=0.5, max_age_minutes=5)
        valid = synced.notna().to_numpy()
        market["SPY"].loc[valid, "spot"] = synced.loc[valid].to_numpy()
    if dedicated_spx is not None:
        valid = dedicated_spx.notna().to_numpy()
        market["SPX"].loc[valid, "spot"] = dedicated_spx.loc[valid].to_numpy()
    for ticker in ('SPY', 'SPX'):
        market[ticker]['spot'] = pd.to_numeric(market[ticker]['spot'], errors='coerce')
        if market[ticker]['spot'].isna().any():
            raw_market = pd.read_csv(DATA / 'market_timeline.csv')
            raw_market['captured_at'] = pd.to_datetime(raw_market['captured_at'].astype(str).str.slice(0,19), errors='coerce')
            raw_spot = raw_market[(raw_market['ticker'] == ticker)].copy()
            raw_spot['spot'] = pd.to_numeric(raw_spot['spot'], errors='coerce')
            raw_series = raw_spot.dropna(subset=['captured_at','spot']).sort_values('captured_at').drop_duplicates('captured_at', keep='last').set_index('captured_at')['spot']
            projected, _ = causal_project_series(raw_series, minute_index, slope_cap=5.0 if ticker == 'SPX' else 0.5, max_age_minutes=20)
            missing = market[ticker]['spot'].isna().to_numpy() & projected.notna().to_numpy()
            market[ticker].loc[missing, 'spot'] = projected.loc[missing].to_numpy()
        market[ticker]['spot'] = market[ticker]['spot'].ffill()
        if market[ticker]['spot'].isna().any():
            bad = market[ticker].loc[market[ticker]['spot'].isna(), 'captured_at'].astype(str).tolist()[:5]
            raise RuntimeError(f'{DAY} {ticker} has unresolved causal spot gaps at {bad}')
    has_real_quotes = not real_chain.empty
    first_real = trade_history["captured_at"].min() if has_trade_history else (real_chain["captured_at"].min() if has_real_quotes else None)
    calibration_day, anchor = calibration_anchor(DAY, real_chain)
    snapshots = []
    for i, ts in enumerate(minute_index):
        spy, spx = market["SPY"].iloc[i], market["SPX"].iloc[i]
        spot = float(spy["spot"])
        gamma_flip, call_wall, put_wall, fep_source = latest_levels(gex, "SPY", ts, spot)
        if has_trade_history:
            recent = trade_history[(trade_history["captured_at"] <= ts) & (trade_history["captured_at"] >= ts - pd.Timedelta(minutes=1))].copy()
            recent = recent.sort_values("captured_at").drop_duplicates(["strike", "side"], keep="last") if not recent.empty else recent
            real_rows = rows_from_trade_history(recent, ts, spot) if not recent.empty else []
            fill_rows = path_fill_rows(trade_history, ts, spot)
            real_contracts = {row["contract"] for row in real_rows}
            fill_rows = [row for row in fill_rows if row["contract"] not in real_contracts]
            chain_rows = real_rows + fill_rows
            live_quote_rows = []
            if has_real_quotes:
                eligible = real_chain[real_chain["captured_at"] <= ts]
                if not eligible.empty:
                    stamp = eligible["captured_at"].max()
                    # Do not carry a stale chain snapshot indefinitely.
                    if (ts - stamp).total_seconds() <= 7 * 60:
                        live_quote_rows = quote_rows_from_real(eligible[eligible["captured_at"] == stamp], spot)
            if live_quote_rows:
                by_contract = {row["contract"]: row for row in chain_rows}
                by_contract.update({row["contract"]: row for row in live_quote_rows})
                chain_rows = list(by_contract.values())
            if live_quote_rows and real_rows:
                quote_source = "REAL_QUOTE_PLUS_REAL_TRADE_OHLCV"
            elif live_quote_rows:
                quote_source = "REAL_QUOTE_WITH_HISTORY_FILL" if fill_rows else "REAL_QUOTE"
            elif real_rows and fill_rows:
                quote_source = "REAL_TRADE_OHLCV_WITH_PATH_FILL"
            elif real_rows:
                quote_source = "REAL_TRADE_OHLCV"
            elif fill_rows:
                quote_source = fill_rows[0]["quoteSource"]
            else:
                quote_source = "SYNTHETIC_CALIBRATED"
                chain_rows = synth_rows(anchor, ts, spot, quote_source)
        elif has_real_quotes and ts >= first_real:
            eligible = real_chain[real_chain["captured_at"] <= ts]
            stamp = eligible["captured_at"].max()
            chain_rows = quote_rows_from_real(eligible[eligible["captured_at"] == stamp], spot)
            quote_source = "REAL_QUOTE"
        else:
            quote_source = "SYNTHETIC_CALIBRATED" if has_real_quotes else "SYNTHETIC_CROSS_DAY_CALIBRATED"
            chain_rows = synth_rows(anchor, ts, spot, quote_source)
        iv_values = [q["iv"] for q in chain_rows if q.get("iv") is not None]
        snapshots.append({"time": ts.strftime("%H:%M:%S"), "spySpot": spot, "spxSpot": float(spx["spot"]), "netGex": float(spy["net_exposure"]), "netGexSpx": float(spx["net_exposure"]), "callDom": float(spy["call_dominance_pct"]) / 100.0, "callDomSpx": float(spx["call_dominance_pct"]) / 100.0, "gammaFlip": gamma_flip, "callWall": call_wall, "putWall": put_wall, "iv": float(np.median(iv_values)) if iv_values else 0.20, "quoteSource": quote_source, "calibrationSourceDay": DAY if (has_trade_history or has_real_quotes) else calibration_day, "marketSource": "NATIVE_OBSERVED_PLUS_CAUSAL_PROJECTION", "fepSource": fep_source, "orderFlow": order_flow.get(ts.floor("min")), "chain": chain_rows})
    snapshots = repair_reference_walls(DAY, snapshots)
    # A real replay must never silently carry one underlying price through a large part of the day.
    def longest_spot_flat(key):
        best = current = 1
        for prev, cur in zip(snapshots, snapshots[1:]):
            if abs(float(cur[key]) - float(prev[key])) < 1e-9:
                current += 1; best = max(best, current)
            else:
                current = 1
        return best
    longest_flat = longest_spot_flat("spySpot")
    longest_flat_spx = longest_spot_flat("spxSpot")
    if has_trade_history and longest_flat > 90:
        raise RuntimeError(f"{DAY} replay has {longest_flat} consecutive frozen SPY 20-second ticks; inspect full-day option/spot inputs")
    if longest_flat_spx > 90:
        raise RuntimeError(f"{DAY} replay has {longest_flat_spx} consecutive frozen SPX 20-second ticks; repair or reject the SPX path")
    playback_seconds = 20 if len(snapshots) >= 1000 else 60
    source_seconds = SOURCE_INTERVAL_SECONDS.get(DAY, 300)
    return {"date": DAY, "label": f"{DAY} | Unified native SPY/SPX | {playback_seconds}-second playback | {source_seconds//60 if source_seconds>=60 else source_seconds}{'m source' if source_seconds>=60 else 's source'}", "dayType": "REAL DATA REPLAY", "playbackIntervalSeconds": playback_seconds, "sourceIntervalSeconds": source_seconds, "nativeSourceCadence": source_seconds == playback_seconds, "coverage": {"realChainStart": first_real.strftime("%H:%M") if first_real is not None else None, "optionCalibrationDay": DAY if (has_trade_history or has_real_quotes) else calibration_day, "optionSource": "REAL_TRADE_OHLCV" if has_trade_history else ("REAL_QUOTE" if has_real_quotes else "SYNTHETIC"), "sourceIntervalSeconds": source_seconds, "playbackIntervalSeconds": playback_seconds, "longestFlatSpyTicks": longest_flat, "spotSource": "DEDICATED_INTRADAY_5M_CAUSAL" if dedicated_spy is not None else "CONTRACT_OR_MARKET_TIMELINE_CAUSAL", "lookaheadSafe": True}, "snapshots": snapshots}


def main():
    catalog = {day: build_day(day) for day in DAYS}
    july10 = catalog.pop("2026-07-10", None)
    OUT.write_text("export const REAL_REPLAY_CATALOG = " + json.dumps(catalog, separators=(",", ":")) + ";\n", encoding="utf-8")
    if july10 is not None:
        OUT_JUL10.write_text("export const JULY10_REPLAY = " + json.dumps(july10, separators=(",", ":")) + ";\n", encoding="utf-8")
    for day, payload in catalog.items():
        counts = pd.Series([x["quoteSource"] for x in payload["snapshots"]]).value_counts().to_dict()
        print(day, len(payload["snapshots"]), counts, payload["coverage"])


if __name__ == "__main__":
    main()

