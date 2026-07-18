# FirstSignal Knowledge Pipeline

This folder is the single source of truth for simulator evidence, reviews, findings, campaigns, approvals, fixes, and validated learning.

## Read order

1. `PIPELINE.md` explains the routing and lifecycle.
2. `pipeline-manifest.json` identifies the active schema and directories.
3. `07-indexes/` contains lightweight generated indexes.
4. `03-findings/canonical-findings.json` contains the current knowledge state.
5. `01-sessions/` contains complete primary evidence for every run.

## Core rule

Raw observations are evidence, not truth. Only adjudicated and validated findings may become durable guidance for future agents.

## Folder map

- `01-sessions` complete replay evidence and per-session meetings
- `02-campaigns` campaign definitions, run membership, proposals, outcomes
- `03-findings` raw backlog and canonical root-cause findings
- `04-reviews` global review indexes and adjudication summaries
- `05-memory` validated version-aware memory supplied to future agents
- `06-state` disposable runtime state and supervisor checkpoints
- `07-indexes` compact AI and human navigation indexes
- `08-schemas` machine-readable data contracts
- `90-archive` migration records and superseded material
