# v0.8.0 release notes

This document describes the published v0.8.0 release.

## Adaptive phase routing

Qing now classifies the remaining phase at every new user turn and before child creation, reactivation, revision, or review. A prior Full phase no longer locks later deterministic evidence work into Full: it can move to Lite or Direct when that is the smallest sufficient tier.

## Review safety is retained

An unaccepted high-risk artifact records a pending independent-review obligation. Temporary Direct or Lite phases do not clear it. Qing restores Full only at final acceptance, where an independent Reviewer resolves the obligation.

## Coordination and budgets

Desktop coordination is milestone-driven: one bounded wait for a meaningful event or terminal result, followed by one takeover/replacement decision only after a real no-progress timeout. It explicitly forbids repeated unchanged polling and interrupt/reactivate loops.

Adaptive Full now defaults to at most two children and one revision. Existing Handoffs remain readable. Users who need a larger bounded Full workflow can still set an explicit configuration within the runtime validation maximum.

## Runtime hardening

For v0.8-marked Relay Handoffs, a Direct phase now returns `PARENT_ACTION_REQUIRED` before any Executor or Reviewer invocation, and a Lite phase returns `PARENT_VERIFICATION_REQUIRED` after one Executor without an independent review. Lite returns the actual Executor evidence and any post-execution gate report in `pendingParentVerification`; it never fabricates a Review. These are explicitly non-complete states. The legacy v0.7 `3/2` contract requires a precise `{ id, fingerprint }` entry in `orchestration.legacyV07Compatibility`; the Full runtime's `legacy-fingerprint <handoff.json>` command produces it. Runtime recomputes the normalized SHA-256, so a replacement Handoff cannot reuse an allowlisted ID. Desktop child coordination uses a stateful tracker; CLI Relay remains event-driven and does not invent desktop takeovers.

Release archives are produced only by PowerShell Core 7.6.x (`pwsh`), the same runtime used by the release workflow. The packager rejects Windows PowerShell 5.1 rather than allowing a byte-different ZIP that contains the same files.

## Verification boundary

Unit tests exercise de-escalation, review restoration, child coordination, default budgets, and explicit bounded overrides. These are control-plane guarantees; connected model token use and elapsed time need continuing real-task measurement.
