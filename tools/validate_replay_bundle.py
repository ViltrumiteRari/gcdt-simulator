import json
from pathlib import Path

path = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\src\realReplayData.js")
text = path.read_text(encoding="utf-8")
data = json.loads(text.split("=", 1)[1].rsplit(";", 1)[0])

counts = {"both": 0, "call_only": 0, "put_only": 0, "none": 0}
sources = {}
bad = []

for snap in data["snapshots"]:
    source = snap["quoteSource"]
    sources[source] = sources.get(source, 0) + 1
    spot = snap["spySpot"]
    calls = [
        row for row in snap["chain"]
        if row["side"] == "CALL"
        and row["strike"] >= spot + 0.5
        and 0.12 <= row["ask"] <= 0.50
        and abs(row["strike"] - spot) <= 5.5
    ]
    puts = [
        row for row in snap["chain"]
        if row["side"] == "PUT"
        and row["strike"] <= spot - 0.5
        and 0.12 <= row["ask"] <= 0.50
        and abs(row["strike"] - spot) <= 5.5
    ]
    if calls and puts:
        counts["both"] += 1
    elif calls:
        counts["call_only"] += 1
    elif puts:
        counts["put_only"] += 1
    else:
        counts["none"] += 1
        bad.append(snap["time"])

print("snapshots", len(data["snapshots"]))
print("sources", sources)
print("candidate_coverage", counts)
print("no_candidate_times", bad[:40])
print("time_sequence", data["snapshots"][0]["time"], data["snapshots"][1]["time"], data["snapshots"][-1]["time"])
