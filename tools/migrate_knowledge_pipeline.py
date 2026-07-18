from pathlib import Path
import json, shutil, datetime, re

project = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1")
legacy = Path(r"C:\Users\adahy\Documents\FirstSignal Sim v1 Agent Reports")
root = project / "knowledge-pipeline"
folders = {
    "sessions": root / "01-sessions",
    "campaigns": root / "02-campaigns",
    "findings": root / "03-findings",
    "reviews": root / "04-reviews",
    "memory": root / "05-memory",
    "state": root / "06-state",
    "indexes": root / "07-indexes",
    "schemas": root / "08-schemas",
    "archive": root / "90-archive",
}
for p in folders.values(): p.mkdir(parents=True, exist_ok=True)

def copy_merge(src: Path, dst: Path):
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    elif src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

migrated = []
if legacy.exists():
    for item in legacy.iterdir():
        if item.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", item.name):
            copy_merge(item, folders["sessions"] / item.name)
            migrated.append(str(item))
    mappings = {
        "version-memory.json": folders["memory"] / "version-memory.json",
        "engineering-backlog.json": folders["findings"] / "engineering-backlog.json",
        "durable-findings.json": folders["findings"] / "canonical-findings.json",
        "supervisor-state.json": folders["state"] / "supervisor-state.json",
    }
    for name, dst in mappings.items():
        src = legacy / name
        if src.exists():
            copy_merge(src, dst)
            migrated.append(str(src))

stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest = {
    "pipelineVersion": 2,
    "createdAtUtc": stamp,
    "projectRoot": str(project),
    "pipelineRoot": str(root),
    "legacySource": str(legacy),
    "legacySourcePreserved": True,
    "migratedPaths": migrated,
    "routing": [
        "session event -> raw session evidence",
        "observer report -> raw observation",
        "review meeting -> adjudication evidence",
        "canonical finding -> approval/fix/validation lifecycle",
        "validated finding -> version memory and future-agent context",
    ],
}
(root / "pipeline-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
(folders["archive"] / "legacy-migration-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"ok": True, "root": str(root), "migrated": len(migrated)}, indent=2))
