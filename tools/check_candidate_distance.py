import json
from pathlib import Path

path = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")
data = json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].rsplit(";", 1)[0])

for gap in (0.50, 0.25, 0.00, -0.25):
    counts = {"both": 0, "one": 0, "none": 0}
    bad = []
    for snap in data["snapshots"]:
        if snap["quoteSource"] != "SYNTHETIC_CALIBRATED":
            continue
        spot = snap["spySpot"]
        calls = [q for q in snap["chain"] if q["side"] == "CALL" and q["strike"] >= spot + gap and 0.12 <= q["ask"] <= 1.50]
        puts = [q for q in snap["chain"] if q["side"] == "PUT" and q["strike"] <= spot - gap and 0.12 <= q["ask"] <= 1.50]
        if calls and puts:
            counts["both"] += 1
        elif calls or puts:
            counts["one"] += 1
        else:
            counts["none"] += 1
            bad.append(snap["time"])
    print(gap, counts, bad[:15])
