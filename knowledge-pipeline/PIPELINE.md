# Routing and Learning Lifecycle

## Evidence flow

`Replay event` → `01-sessions/<date>/<session>/events.jsonl`

`Observer report` → session `reports.jsonl` as `RAW_OBSERVATION`

`Review meeting` → session `meetings/<meeting>/` with evidence packet, Observer memo, Trader memo, and final reflection

`Supervisor adjudication` → `03-findings/canonical-findings.json`

`Human/code decision` → validated, rejected, superseded, or awaiting validation

`Validation campaign` → links the fix build to repeated replay outcomes

`Validated learning` → `05-memory/version-memory.json` for future agents

## Finding lifecycle

- `RAW_OBSERVATION`: model-generated report, not trusted yet
- `REVIEWED_PENDING_ADJUDICATION`: meeting completed, conclusion still unresolved
- `VALIDATED`: evidence and code inspection support the finding
- `PARTIALLY_VALIDATED`: root issue exists but the original explanation overreached
- `REJECTED`: report interpretation was unsupported
- `FIXED_PENDING_VALIDATION`: code changed but replay confirmation is outstanding
- `FIX_VERIFIED`: validation campaign confirmed the correction
- `SUPERSEDED`: merged into a canonical root cause or replaced by better evidence

## Timestamp contract

Every durable record should carry:

- `observedAtUtc` for exact machine ordering
- `observedAtLocal` for human readability
- `localDate` for the real review date
- `replayDate` for the market session being replayed
- `marketDate` and `marketTime` for trade chronology
- `chronologicalKey` for deterministic sorting

A market time such as `9:45 AM` is never sufficient by itself outside transient UI display.
