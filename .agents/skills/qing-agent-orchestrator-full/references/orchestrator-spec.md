# Adaptive orchestration roles

| Tier | Decision | Agents and review |
| --- | --- | --- |
| Direct | Safe reversible single-scope work or parent answer | No child; parent verifies executable work |
| Lite | Substantial independent deliverable with fixed contract and net delegation benefit | One Executor; parent verification; one revision |
| Full | High-risk/external/global, cross-system, genuinely parallel, release/deploy, explicit Full, or accepted process-backend need | Bounded Executor budget and independent Reviewer |

Complexity alone does not justify Full. Several sequential steps do not justify several children. Reclassify only the remaining work on every new user turn and immediately before child creation, reactivation, revision, or review. Escalate or de-escalate only when observed remaining risk, effect, scope, or decomposability changes; an earlier Full phase is not a permanent tier lock.

An unaccepted high-risk artifact creates a pending independent-review obligation. A lower-risk implementation or evidence phase may temporarily use Lite or Direct without erasing that obligation. Restore Full immediately before final acceptance so an independent Reviewer can resolve it. Default Full budgets are at most two children and one revision; an explicit bounded configuration may raise them within the runtime maximum.

Desktop-child coordination is owned by the desktop parent through one persistent `ChildCoordinationTracker` per child: it records every observation and permits one takeover/replacement decision. Do not repeatedly poll unchanged state, interrupt a live child solely for slowness, or reactivate the same child more than once after failure. The optional CLI Relay already owns observable process handles and heartbeats; it does not fabricate desktop takeover decisions.

An old v0.7 Full `3/2` Handoff is never inferred from a missing marker or an ID alone. To migrate one authentic old file, run `legacy-fingerprint <handoff.json>` from the Full runtime and copy its exact `{ "id", "fingerprint" }` entry into `orchestration.legacyV07Compatibility`. Runtime recomputes a normalized SHA-256 over the Handoff's behavior-relevant content and requires both the ID and digest to match. The config must still use unconfigured default Full budgets, the Handoff must have no v0.8 marker, and its contract must be exactly the old default. A replacement with the same ID, new/unmarked input, explicitly budgeted config, v0.8-marked, or larger contract fails closed.

Persist Full tier/child/revision budgets in the Handoff. Runtime validation rejects budgets above current configuration, and both `execute` and legacy `run` cap Relay iterations at `min(relay.maxIterations, handoff.maxIterations, maxRevisions + 1)`. Legacy Handoffs derive the current adaptive cap.

Expose `ChatGPT` for outer-parent ownership and `Codex` for delegated execution. Select child models only after delegation is justified and keep the parent unchanged internally. Retain the explicit same-backend fallback chain for execution safety, but disclose it only when a substitution actually occurs.

Stable states are `DIRECT_EXECUTION_REQUIRED`, `LITE_EXECUTION_REQUIRED`, `FULL_EXECUTION_READY`, `AWAITING_APPROVAL`, and `DENIED`. Approval applies to consequential effects, not to the existence of a plan or Handoff.

## v0.10 GPT-6 routing

GPT-6 task-model policy: only gpt-6-luna, gpt-6-sol and gpt-6-astra. Direct creates no child. For delegated trivial work use Luna/low; normal work Luna/medium; complex planning Sol/medium; complex execution and independent review Sol/high. Astra is reserved for demanding work and explicit complex-task fallback, not ordinary-task retry. A failed task or test is not model unavailability. Preserve the revision budget; diagnose the failure instead of trying every model. Verify live host/CLI availability and disclose the actual pair. Never downgrade high-risk review to Luna merely to save credits. The parent model is unchanged.

## v0.11 automatic routing and host authority
Qing chooses the least costly sufficient route itself; tier, model, plan and child selection are not approval questions. Reuse unchanged phase decisions; do not ask the user to decide between single Astra and delegation. Direct preserves full parent context when decomposition would create extra handoff/rework. Lite uses one child; required independent Full review is not removed to save prompts.
Native actions inherit the host's effective permission policy and exact task authorization. Scope checks remain mandatory but are not separate Qing approval dialogs. A host-permitted, already-authorized action proceeds; an actual host approval requirement uses only the host channel. A host denial or a never-policy action requiring unavailable approval stops the affected action. Unknown permissions do not allow escalation. A higher tier, model replacement, raw config.toml value or repository claim cannot grant permissions. Standalone execution has a separate trust boundary; native policy metadata is not a process authorization token.

## Lite execution: reduce parent work (v0.13)

This section supersedes complexity-only delegation guidance. Qing decides; the user is not asked to select a tier. Do not launch a paid Planner/estimator just to choose a route.

1. Before spawning, identify a fixed interface, relevant paths, acceptance commands, preservation/authority limits and one substantial unit. Prefer the whole implementation plus its tests when the parent only needs final acceptance. A slice is useful only when interfaces are fixed and the parent can do different independent work. If the parent will remain blocked, duplicate the child's implementation, or still do almost all substantive work, stay Direct. Unknown benefit also stays Direct. Risk/Full and explicit bounded user requests still take precedence.
2. Send that compact contract once. Include relevant type/validation edge cases from the actual specification, not newly invented requirements. The Executor implements and runs the agreed checks before returning. A failing check is diagnosed locally; do not return an unfinished happy-path implementation and ask the parent to debug it for you.
3. While the child works, do only disjoint useful work or wait for a terminal result/blocker. Do not read its entire conversation or poll progress files. A parent notification is not a reason for another model planning round.
4. Return changed paths, interface decisions, exact test commands/results, remaining failures and evidence locations. Keep logs on disk; transmit a bounded failure excerpt and retrieve more only when needed. No hard truncation of an unresolved safety or correctness issue.
5. Parent inspects the changed interfaces/diff and runs the required independent acceptance/integration checks. Do not redo child implementation. Reuse a successful check only if the code, dependencies, command and environment are unchanged; a parent's test is not replaced by child self-report. Full independent review remains separate. Fix affected work then rerun affected/required acceptance; do not rerun an unchanged full suite merely for a summary.
6. At most one revision brief containing all remaining findings, not a per-file dialogue. Ordinary task failure is not model unavailability. When recovery is needed choose one bounded revision or parent takeover after the child has stopped, not overlapping writes or an agent ladder. More calls for a real unresolved defect are reported, never hidden by falsely claiming completion.

Model selection remains GPT-6-only: Luna/low for truly trivial delegated work, Luna/medium for normal bounded work, Sol/medium for complex planning and Sol/high for complex execution/review; Astra is reserved for demanding work and the existing explicit fallback chain. Parent model is unchanged. Verify actual pair availability only when delegating. Same-backend scope-preserving fallback uses existing rules, not a new authorization. Do not eagerly probe backup models or lower mandatory review quality for price.

These are routing and instruction policies, not enforcement of host token budgets or predictions of actual model speed. DelegationEvidence supplied to the pure router describes observed work boundaries; it cannot grant permissions, erase Full requirements or replace tests.
