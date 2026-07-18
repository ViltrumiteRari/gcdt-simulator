import json
from pathlib import Path

repo = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1")
main_path = repo / "src" / "realReplayData.js"
text = main_path.read_text(encoding="utf-8")
payload = json.loads(text.split("=", 1)[1].rsplit(";", 1)[0])
july10 = payload.pop("2026-07-10")
main_path.write_text(
    "export const REAL_REPLAY_CATALOG = " + json.dumps(payload, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
(repo / "src" / "realReplayDataJul10.js").write_text(
    "export const JULY10_REPLAY = " + json.dumps(july10, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(main_path.stat().st_size, (repo / "src" / "realReplayDataJul10.js").stat().st_size)
