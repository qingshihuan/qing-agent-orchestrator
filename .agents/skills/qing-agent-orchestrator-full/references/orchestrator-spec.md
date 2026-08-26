# Adaptive orchestration roles

| Tier | Decision | Agents and review |
| --- | --- | --- |
| Direct | Safe reversible single-scope work or parent answer | No child; parent verifies executable work |
| Lite | Bounded complex/multi-step work | One Executor; parent verification; one revision |
| Full | High-risk/external/global, cross-system, genuinely parallel, release/deploy, explicit Full, or accepted process-backend need | Bounded Executor budget and independent Reviewer |

Complexity alone does not justify Full. Several sequential steps do not justify several children. Reclassify only the remaining work on every new user turn and immediately before child creation, reactivation, revision, or review. Escalate or de-escalate only when observed remaining risk, effect, scope, or decomposability changes; an earlier Full phase is not a permanent tier lock.

An unaccepted high-risk artifact creates a pending independent-review obligation. A lower-risk implementation or evidence phase may temporarily use Lite or Direct without erasing that obligation. Restore Full immediately before final acceptance so an independent Reviewer can resolve it. Default Full budgets are at most two children and one revision; an explicit bounded configuration may raise them within the runtime maximum.

Desktop-child coordination is owned by the desktop parent through one persistent `ChildCoordinationTracker` per child: it records every observation and permits one takeover/replacement decision. Do not repeatedly poll unchanged state, interrupt a live child solely for slowness, or reactivate the same child more than once after failure. The optional CLI Relay already owns observable process handles and heartbeats; it does not fabricate desktop takeover decisions.

An old v0.7 Full `3/2` Handoff is never inferred from a missing marker or an ID alone. To migrate one authentic old file, run `legacy-fingerprint <handoff.json>` from the Full runtime and copy its exact `{ "id", "fingerprint" }` entry into `orchestration.legacyV07Compatibility`. Runtime recomputes a normalized SHA-256 over the Handoff's behavior-relevant content and requires both the ID and digest to match. The config must still use unconfigured default Full budgets, the Handoff must have no v0.8 marker, and its contract must be exactly the old default. A replacement with the same ID, new/unmarked input, explicitly budgeted config, v0.8-marked, or larger contract fails closed.

Persist Full tier/child/revision budgets in the Handoff. Runtime validation rejects budgets above current configuration, and both `execute` and legacy `run` cap Relay iterations at `min(relay.maxIterations, handoff.maxIterations, maxRevisions + 1)`. Legacy Handoffs derive the current adaptive cap.

Expose `ChatGPT` for outer-parent ownership and `Codex` for delegated execution. Select child models only after delegation is justified and keep the parent unchanged internally. Retain the explicit same-backend fallback chain for execution safety, but disclose it only when a substitution actually occurs.

Stable states are `DIRECT_EXECUTION_REQUIRED`, `LITE_EXECUTION_REQUIRED`, `FULL_EXECUTION_READY`, `AWAITING_APPROVAL`, and `DENIED`. Approval applies to consequential effects, not to the existence of a plan or Handoff.
