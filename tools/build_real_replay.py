import json
from pathlib import Path

import pandas as pd

DAY = "2026-07-08"
DATA = Path(r"D:\FirstSignal_Sim_Dataset") / DAY / "sim_input"
OUT = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")

market = pd.read_csv(DATA / "market_timeline.csv")
gex = pd.read_csv(DATA / "gex_key_levels.csv")
real = pd.read_csv(DATA / "options_focus.csv")
synth = pd.read_csv(DATA / "spy_options_synthetic_fallback.csv")

for frame in (market, gex, real, synth):
    frame["captured_at"] = pd.to_datetime(frame["captured_at"])
spy = market[(market["ticker"] == "SPY") & (market["source"] == "gex_exposure")].copy()
spx = market[(market["ticker"] == "SPX") & (market["source"] == "gex_exposure")].copy()
spy = spy.sort_values("captured_at").drop_duplicates("captured_at")
spx = spx.sort_values("captured_at").drop_duplicates("captured_at")

spy = spy[(spy["captured_at"].dt.time >= pd.Timestamp("09:30").time()) & (spy["captured_at"].dt.time <= pd.Timestamp("16:15").time())]
spx = spx[(spx["captured_at"].dt.time >= pd.Timestamp("09:30").time()) & (spx["captured_at"].dt.time <= pd.Timestamp("16:15").time())]

real = real[(real["underlying"] == "SPY") & (real["expiration"].astype(str) == DAY)].copy()
synth = synth[synth["expiration"].astype(str) == DAY].copy()
real["quote_source"] = "REAL"
synth["quote_source"] = "SYNTHETIC_CALIBRATED"
quotes = pd.concat([synth, real], ignore_index=True, sort=False)
snapshots = []
for _, row in spy.iterrows():
    ts = row["captured_at"]
    spx_row = spx.iloc[(spx["captured_at"] - ts).abs().argsort()[:1]].iloc[0]
    key_rows = gex[(gex["ticker"] == "SPY") & (gex["captured_at"] <= ts)]
    if not key_rows.empty:
        key_ts = key_rows["captured_at"].max()
        key_rows = key_rows[key_rows["captured_at"] == key_ts]
    spot = float(row["spot"])
    call_wall = float(key_rows.loc[key_rows["net_exposure"].idxmax(), "strike"]) if not key_rows.empty else spot + 5
    put_wall = float(key_rows.loc[key_rows["net_exposure"].idxmin(), "strike"]) if not key_rows.empty else spot - 5
    gamma_flip = float(key_rows.iloc[(key_rows["strike"] - spot).abs().argsort()[:1]]["strike"].iloc[0]) if not key_rows.empty else spot
    eligible = quotes[quotes["captured_at"] <= ts]
    chain_rows = []
    source = "NONE"
    if not eligible.empty:
        quote_ts = eligible["captured_at"].max()
        current = eligible[eligible["captured_at"] == quote_ts].copy()
        current = current[(current["strike"] - spot).abs() <= 8]
        source = str(current["quote_source"].iloc[0]) if not current.empty else "NONE"
        for _, q in current.iterrows():
            chain_rows.append({
                "contract": str(q["contract"]),
                "strike": float(q["strike"]),
                "side": "CALL" if str(q["type"]).lower() == "call" else "PUT",
                "bid": float(q["bid"]),
                "ask": float(q["ask"]),
                "mid": float(q.get("mid", (q["bid"] + q["ask"]) / 2)),
                "iv": float(q["iv"]),
                "quoteSource": str(q["quote_source"]),
            })
    snapshots.append({
        "time": ts.strftime("%H:%M"),
        "spySpot": spot,
        "spxSpot": float(spx_row["spot"]),
        "netGex": float(row["net_exposure"]),
        "netGexSpx": float(spx_row["net_exposure"]),
        "callDom": float(row["call_dominance_pct"]) / 100.0,
        "callDomSpx": float(spx_row["call_dominance_pct"]) / 100.0,
        "gammaFlip": gamma_flip,
        "callWall": call_wall,
        "putWall": put_wall,
        "iv": float(current["iv"].median()) if not eligible.empty and not current.empty else 0.20,
        "quoteSource": source,
        "chain": chain_rows,
    })

payload = {
    "date": DAY,
    "label": "Jul 8 · Native SPY/SPX + calibrated chain fallback",
    "dayType": "REAL DATA REPLAY",
    "snapshots": snapshots,
}
OUT.write_text("export const REAL_REPLAY_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
print(OUT, len(snapshots), sum(len(x["chain"]) for x in snapshots))
