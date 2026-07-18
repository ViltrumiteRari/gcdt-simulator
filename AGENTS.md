# FirstSignal Sim Agent Entry Point

Any AI or engineer working in this repository should begin with:

1. `README.md`
2. `knowledge-pipeline/00_START_HERE.md`
3. `knowledge-pipeline/PIPELINE.md`
4. `knowledge-pipeline/07-indexes/CURRENT_STATUS.json`
5. `knowledge-pipeline/03-findings/canonical-findings.json`

## Knowledge rules

- A raw Observer report is evidence, not established truth.
- Meeting notes are review evidence, not automatically canonical conclusions.
- Canonical findings are grouped by root cause and carry an explicit lifecycle status.
- Only `VALIDATED` and `FIX_VERIFIED` findings may be treated as durable guidance.
- `FIXED_PENDING_VALIDATION` means code changed but replay confirmation is still required.
- Never infer chronology from a bare time such as `9:45 AM`; use the attached market date and UTC/local metadata.

## Runtime constraints

Keep the pipeline append-friendly, dependency-light, and safe for low-resource machines. Prefer JSONL for event streams, compact JSON indexes, bounded history arrays, and incremental updates over loading the entire archive into memory.
