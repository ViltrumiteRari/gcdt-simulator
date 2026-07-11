import json
import math
import tarfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

DAYS = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]
ROOT = Path(r"D:\FirstSignal_GCDT_Dataset")
OUT = Path(r"C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\realReplayData.js")
OUT_JUL10 = Path(r"C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\realReplayDataJul10.js")
FALLBACK_CATALOG = Path(r"C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\replayCatalog.js")
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


def load_market():
    market = pd.read_csv(DATA / "market_timeline.csv")
    market["captured_at"] = pd.to_datetime(market["captured_at"], format="mixed")
    minute_index = pd.date_range(f"{DAY} 09:30:00", f"{DAY} 16:15:00", freq="1min")
    out = {}
    first_native_spot = {}
    for ticker in ("SPY", "SPX"):
        frame = market[(market["ticker"] == ticker) & (market["source"].isin(["gex_exposure", "spot", "market_context"]))].copy()
        native_spot_rows = frame[pd.to_numeric(frame["spot"], errors="coerce").notna()]
        first_native_spot[ticker] = native_spot_rows["captured_at"].min() if not native_spot_rows.empty else None
        priority = {"gex_exposure": 0, "spot": 1, "market_context": 2}
        frame["_priority"] = frame["source"].map(priority).fillna(9)
        frame = frame.sort_values(["captured_at", "_priority"]).drop_duplicates("captured_at", keep="first")
        # Reject stale intraminute spot injections when reliable 5-minute anchors exist.
        # These can otherwise create impossible multi-dollar sawteeth in the replay chart.
        spot_num = pd.to_numeric(frame["spot"], errors="coerce")
        anchor_mask = (frame["captured_at"].dt.second == 0) & (frame["captured_at"].dt.minute % 5 == 0) & spot_num.notna()
        anchors = frame.loc[anchor_mask, ["captured_at"]].copy()
        anchors["anchor_spot"] = spot_num.loc[anchor_mask].to_numpy()
        if len(anchors) >= 2:
            anchor_series = anchors.set_index("captured_at")["anchor_spot"]
            full_index = frame["captured_at"]
            expected = anchor_series.reindex(anchor_series.index.union(full_index)).sort_index().interpolate(method="time").reindex(full_index).to_numpy()
            stale = spot_num.notna() & np.isfinite(expected) & ((spot_num.to_numpy() - expected).astype(float).__abs__() > 1.50)
            frame.loc[stale, "spot"] = np.nan
        frame = frame.set_index("captured_at")
        numeric = ["spot", "total_call_exposure", "total_put_exposure", "net_exposure", "call_dominance_pct", "max_abs_gamma_strike", "max_positive_strike", "max_negative_strike"]
        for col in numeric:
            if col not in frame:
                frame[col] = np.nan
        frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
        frame = frame.reindex(frame.index.union(minute_index)).sort_index()
        frame[numeric] = frame[numeric].interpolate(method="time").ffill().bfill()
        out[ticker] = frame.loc[minute_index].reset_index(names="captured_at")

    # Repair stale captured spot values with the independent option-chain underlying path.
    # July 9's GEX/spot endpoint repeated one stale spot after noon even while the chain's
    # underlying field continued updating. Prefer the chain path for price only; keep GEX
    # and call-dominance from their native exposure feeds.
    focus_path = DATA / "options_focus.csv"
    if focus_path.exists():
        focus = pd.read_csv(focus_path)
        focus["captured_at"] = pd.to_datetime(focus["captured_at"])
        for ticker, underlying in (("SPY", "SPY"), ("SPX", "^SPX")):
            fx = focus[focus["underlying"] == underlying].copy()
            if fx.empty:
                continue
            fx["spot"] = pd.to_numeric(fx["spot"], errors="coerce")
            series = fx.dropna(subset=["spot"]).groupby("captured_at")["spot"].median().sort_index()
            if series.empty:
                continue
            series = series.reindex(series.index.union(minute_index)).sort_index().interpolate(method="time").ffill().bfill().reindex(minute_index)
            start = fx["captured_at"].min().floor("min")
            mask = out[ticker]["captured_at"] >= start
            out[ticker].loc[mask, "spot"] = series.loc[mask.to_numpy()].to_numpy()
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
            legacy_spx = legacy_spx.reindex(legacy_spx.index.union(minute_index)).sort_index().interpolate(method="time").reindex(minute_index)
            anchor_idx = int(np.searchsorted(minute_index.values, np.datetime64(first_spx), side="left"))
            anchor_idx = min(max(anchor_idx, 0), len(minute_index) - 1)
            native_anchor = float(out["SPX"].iloc[anchor_idx]["spot"])
            legacy_anchor = float(legacy_spx.iloc[anchor_idx])
            pre_mask = out["SPX"]["captured_at"] < first_spx
            out["SPX"].loc[pre_mask, "spot"] = legacy_spx.loc[pre_mask.to_numpy()].to_numpy() + (native_anchor - legacy_anchor)
    # When SPY collection starts late, reconstruct it from the now-complete SPX path at
    # the natural ~10:1 scale, anchored to the first real SPY minute for continuity.
    first_spy = first_native_spot.get("SPY")
    if first_spy is not None and first_spy > minute_index[0]:
        anchor_idx = int(np.searchsorted(minute_index.values, np.datetime64(first_spy), side="left"))
        anchor_idx = min(max(anchor_idx, 0), len(minute_index) - 1)
        anchor_spy = float(out["SPY"].iloc[anchor_idx]["spot"])
        anchor_spx = float(out["SPX"].iloc[anchor_idx]["spot"])
        pre_mask = out["SPY"]["captured_at"] < first_spy
        out["SPY"].loc[pre_mask, "spot"] = anchor_spy + (out["SPX"].loc[pre_mask, "spot"] - anchor_spx) / 10.0
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


def read_trade_history(day):
    base = ROOT / day / "options_historical_quantdata" / "contract_price_time"
    candidates = [
        base / "regular_0930_1615_contract_ohlcv.csv",
        base / "regular_0930_1615_contract_ohlcv.csv.gz",
        base / "morning_0930_1200_contract_ohlcv.csv",
        base / "morning_0930_1200_contract_ohlcv.csv.gz",
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
    frame["captured_at"] = pd.to_datetime(frame["captured_at"])
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


def path_fill_rows(history, ts, spot, bridge_limit=60, forward_limit=15):
    expiry = datetime.fromisoformat(f"{DAY}T16:15:00")
    target_t = max((expiry - ts.to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
    rows = []
    nearby = history[(history["strike"] - spot).abs() <= 10]
    for (strike, side), group in nearby.groupby(["strike", "side"]):
        group = group.sort_values("captured_at")
        prev = group[group["captured_at"] < ts].tail(2)
        nxt = group[group["captured_at"] > ts].head(1)
        if prev.empty and nxt.empty:
            continue
        kind = "call" if str(side).upper() == "CALL" else "put"
        source = None
        iv = None
        if not prev.empty and not nxt.empty:
            p = prev.iloc[-1]
            n = nxt.iloc[0]
            gap = (n["captured_at"] - p["captured_at"]).total_seconds() / 60
            if gap <= bridge_limit:
                pt = max((expiry - p["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
                nt = max((expiry - n["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
                piv, _ = implied_vol_delta(float(p["underlying_close"]), float(strike), pt, float(p["close"]), kind)
                niv, _ = implied_vol_delta(float(n["underlying_close"]), float(strike), nt, float(n["close"]), kind)
                w = (ts - p["captured_at"]).total_seconds() / max((n["captured_at"] - p["captured_at"]).total_seconds(), 1)
                iv = math.exp((1 - w) * math.log(max(piv, 0.01)) + w * math.log(max(niv, 0.01)))
                source = "SYNTHETIC_PATH_BRIDGED"
        if iv is None and not prev.empty:
            p = prev.iloc[-1]
            age = (ts - p["captured_at"]).total_seconds() / 60
            if age <= forward_limit:
                pt = max((expiry - p["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
                piv, _ = implied_vol_delta(float(p["underlying_close"]), float(strike), pt, float(p["close"]), kind)
                slope = 0.0
                if len(prev) == 2:
                    p0 = prev.iloc[0]
                    p0t = max((expiry - p0["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
                    p0iv, _ = implied_vol_delta(float(p0["underlying_close"]), float(strike), p0t, float(p0["close"]), kind)
                    mins = max((p["captured_at"] - p0["captured_at"]).total_seconds() / 60, 1)
                    slope = (math.log(max(piv, 0.01)) - math.log(max(p0iv, 0.01))) / mins
                iv = math.exp(math.log(max(piv, 0.01)) + slope * age * math.exp(-age / 5))
                source = "SYNTHETIC_PATH_FORWARD"
        if iv is None and prev.empty and not nxt.empty:
            n = nxt.iloc[0]
            age = (n["captured_at"] - ts).total_seconds() / 60
            if age <= forward_limit:
                nt = max((expiry - n["captured_at"].to_pydatetime()).total_seconds(), 1) / (365 * 24 * 3600)
                iv, _ = implied_vol_delta(float(n["underlying_close"]), float(strike), nt, float(n["close"]), kind)
                source = "SYNTHETIC_PATH_BACKWARD"
        if iv is None:
            continue
        price, delta = bs_price_delta(spot, float(strike), target_t, iv, kind)
        side_code = "C" if kind == "call" else "P"
        contract = f"SPY{pd.Timestamp(DAY).strftime('%y%m%d')}{side_code}{int(round(float(strike) * 1000)):08d}"
        rows.append({"contract": contract, "strike": float(strike), "side": kind.upper(), "bid": round(price, 4), "ask": round(price, 4), "mid": round(price, 4), "iv": round(iv, 5), "delta": round(delta, 5), "quoteSource": source})
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
    # Synchronize the displayed SPY path to the same underlying minute bars that
    # generated the real option OHLCV. Using an independently interpolated chain
    # spot beside real contract bars can create impossible option/underlying P&L.
    if has_trade_history:
        synced = trade_history.groupby("captured_at")["underlying_close"].median().sort_index()
        synced = synced.reindex(synced.index.union(minute_index)).sort_index().interpolate(method="time").ffill().bfill().reindex(minute_index)
        valid = synced.notna().to_numpy()
        market["SPY"].loc[valid, "spot"] = synced.loc[valid].to_numpy()
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
        snapshots.append({"time": ts.strftime("%H:%M"), "spySpot": spot, "spxSpot": float(spx["spot"]), "netGex": float(spy["net_exposure"]), "netGexSpx": float(spx["net_exposure"]), "callDom": float(spy["call_dominance_pct"]) / 100.0, "callDomSpx": float(spx["call_dominance_pct"]) / 100.0, "gammaFlip": gamma_flip, "callWall": call_wall, "putWall": put_wall, "iv": float(np.median(iv_values)) if iv_values else 0.20, "quoteSource": quote_source, "calibrationSourceDay": DAY if (has_trade_history or has_real_quotes) else calibration_day, "marketSource": "NATIVE_OBSERVED_PLUS_TIME_INTERPOLATION", "fepSource": fep_source, "orderFlow": order_flow.get(ts.floor("min")), "chain": chain_rows})
    return {"date": DAY, "label": f"{DAY} | Unified native SPY/SPX | 1-minute replay", "dayType": "REAL DATA REPLAY", "coverage": {"realChainStart": first_real.strftime("%H:%M") if first_real is not None else None, "optionCalibrationDay": DAY if (has_trade_history or has_real_quotes) else calibration_day, "optionSource": "REAL_TRADE_OHLCV" if has_trade_history else ("REAL_QUOTE" if has_real_quotes else "SYNTHETIC")}, "snapshots": snapshots}


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
