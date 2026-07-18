import json
from pathlib import Path

path = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")
data = json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].rsplit(";", 1)[0])

summary = {}
bad = []
for snap in data["snapshots"]:
    source = snap["quoteSource"]
    spot = snap["spySpot"]
    side_results = []
    for side in ("CALL", "PUT"):
        rows = [q for q in snap["chain"] if q["side"] == side]
        normal = [
            q for q in rows
            if (q["strike"] >= spot + 0.5 if side == "CALL" else q["strike"] <= spot - 0.5)
            and 0.12 <= q["ask"] <= 0.30
            and abs(q["strike"] - spot) <= 5.5
        ]
        if normal or source != "SYNTHETIC_CALIBRATED":
            eligible = normal
        else:
            eligible = [
                q for q in rows
                if (q["strike"] >= spot - 0.25 if side == "CALL" else q["strike"] <= spot + 0.25)
                and 0.12 <= q["ask"] <= 1.50
                and abs(q["strike"] - spot) <= 1.0
            ]
        side_results.append(bool(eligible))
    key = (source, tuple(side_results))
    summary[key] = summary.get(key, 0) + 1
    if source == "SYNTHETIC_CALIBRATED" and not all(side_results):
        bad.append((snap["time"], side_results))

print("summary")
for key, value in sorted(summary.items(), key=lambda item: str(item[0])):
    print(key, value)
print("synthetic_bad", bad[:20], "count", len(bad))
print("first", data["snapshots"][0]["time"], "last", data["snapshots"][-1]["time"])
print("real_pre_cutoff")
for snap in data["snapshots"]:
    if snap["quoteSource"] != "REAL" or snap["time"] >= "15:45":
        continue
    spot = snap["spySpot"]
    availability = {}
    for side in ("CALL", "PUT"):
        rows = [q for q in snap["chain"] if q["side"] == side]
        availability[side] = any(
            (q["strike"] >= spot + 0.5 if side == "CALL" else q["strike"] <= spot - 0.5)
            and 0.12 <= q["ask"] <= 0.30
            and abs(q["strike"] - spot) <= 5.5
            for q in rows
        )
    print(snap["time"], availability)
