# GCDT Proposed Upgrades

Living backlog for ideas that are not yet approved for implementation.

## Status convention

- **PROPOSED** — worth evaluating, not yet implemented.
- **TESTING** — being measured in replay runs.
- **APPROVED** — ready to implement.
- **IMPLEMENTED** — shipped; keep a short record here.
- ~~REJECTED / REMOVED~~ — intentionally discarded or superseded.

Do not treat anything in this file as active strategy logic unless it is marked **IMPLEMENTED**.

## 1. Dealer dominance / territory model

**Status: PROPOSED**

Create one continuously updated model for how strongly dealer positioning is controlling price, rather than treating GEX sign alone as the regime.

Preferred territory names:

- **Price Discovery Territory** — price is establishing value despite, or independently of, dealer structure.
- **Price Breakdown Territory** — downside price discovery is being amplified and accepted below dealer structure.

The model should distinguish at minimum:

- dealer-dominated pinning / mean reversion
- positive-GEX price discovery
- negative-GEX stretch away from FEP
- active negative-GEX breakdown continuation
- exhausted or failed breakdown
- transition between dealer control and price discovery

Potential evidence inputs:

- return-to-FEP frequency and speed
- failed versus accepted gamma-flip crossings
- rejection or acceptance at call/put walls
- realized range compression or expansion
- FEP migration relative to price
- price persistence away from dealer center
- GEX sign, magnitude, and rate of change
- option-response quality during attempted continuation
- whether positive GEX is actually suppressing movement
- whether negative GEX is accelerating price or merely describing a stretched location

Design constraint: this should be one compact contextual model, not another independent veto layer.

## 2. ITS calibration audit

**Status: TESTING BEFORE CHANGE**

Confirm that ITS is intentionally and consistently mapped to approximately **0–12**, with structural neutrality near **6/12**.

Observed concern:

- Price can remain far below FEP while ITS holds near 2–3, yet the local price action behaves balanced around a lower accepted range.
- The inverse can occur above FEP, where 8+ behaves like a local midpoint rather than an active extension.
- FEP may be stale, slow to migrate, or overly dominant in the ITS calculation.

Before changing ITS, measure whether this repeats across multiple replay runs and dates.

Potential future distinction:

- **Structural ITS** — position relative to FEP and dealer structure.
- **Local ITS** — position relative to the recently accepted trading range.
- Their disagreement would identify lagging FEP, structural stretch, or new accepted territory.

## 3. Persistent AI session reasoning journal

**Status: PROPOSED**

Add a compact persistent text record that gives the API trader durable session memory closer to the continuity available in a live chat.

Store decision-relevant summaries rather than unrestricted hidden reasoning:

- current dominant thesis
- strongest competing thesis
- what materially changed
- expected next path
- invalidation
- unresolved uncertainty
- prior trade or missed-trade lesson
- why the latest trade was entered, skipped, held, or exited
- evidence required to change the conclusion

Suggested structure:

- one compact current-session summary
- append-only event log for audit
- periodic compression of older events
- each API request receives the summary plus only recent material events

Design constraints:

- must remain inspectable and cheap in tokens
- must not create a second strategy authority
- must not encourage repeated confirmation seeking
- must improve continuity without bloating every prompt

## 4. Validation before additional strategy complexity

**Status: ACTIVE PROCESS**

Run the current canonical build several times before changing core ITS or territory logic. Track:

- BUY-ready states versus actual entries
- AI veto count and stated veto reasons
- time spent in WAIT
- CALL/PUT balance
- missed movement after vetoes
- repeated or low-quality entries
- FEP migration versus sustained price acceptance
- ITS location versus local price equilibrium
- dealer-dominance evidence versus actual price response

Primary constraint: upgrades should preserve reasonable trade frequency. Do not add another series of hoops that recreates analysis paralysis.
