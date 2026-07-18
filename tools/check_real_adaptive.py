import json
from pathlib import Path

path = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")
data = json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].rsplit(";", 1)[0])

for snap in data["snapshots"]:
    if snap["quoteSource"] != "REAL" or snap["time"] >= "15:45":
        continue
    spot = snap["spySpot"]
    result = {}
    for side in ("CALL", "PUT"):
        rows = [q for q in snap["chain"] if q["side"] == side]
        normal = [q for q in rows if (q["strike"] >= spot + 0.5 if side == "CALL" else q["strike"] <= spot - 0.5) and 0.12 <= q["ask"] <= 0.30]
        adaptive = [q for q in rows if (q["strike"] >= spot - 0.25 if side == "CALL" else q["strike"] <= spot + 0.25) and 0.12 <= q["ask"] <= 1.50 and abs(q["strike"] - spot) <= 1.5]
        result[side] = (len(normal), len(adaptive), min((q["ask"] for q in adaptive), default=None))
    print(snap["time"], result)
