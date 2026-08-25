# Adaptive orchestration roles

| Tier | Decision | Agents and review |
| --- | --- | --- |
| Direct | Safe reversible single-scope work or parent answer | No child; parent verifies executable work |
| Lite | Bounded complex/multi-step work | One Executor; parent verification; one revision |
| Full | High-risk/external/global, cross-system, genuinely parallel, release/deploy, explicit Full, or accepted process-backend need | Bounded Executor budget and independent Reviewer |

Complexity alone does not justify Full. Several sequential steps do not justify several children. Escalate only when observed risk, effect, scope, or decomposability changes.

Persist Full tier/child/revision budgets in the Handoff. Runtime validation rejects budgets above current configuration, and both `execute` and legacy `run` cap Relay iterations at `min(relay.maxIterations, handoff.maxIterations, maxRevisions + 1)`. Legacy Handoffs derive the current adaptive cap.

Expose `ChatGPT` for outer-parent ownership and `Codex` for delegated execution. Select child models only after delegation is justified and keep the parent unchanged internally. Retain the explicit same-backend fallback chain for execution safety, but disclose it only when a substitution actually occurs.

Stable states are `DIRECT_EXECUTION_REQUIRED`, `LITE_EXECUTION_REQUIRED`, `FULL_EXECUTION_READY`, `AWAITING_APPROVAL`, and `DENIED`. Approval applies to consequential effects, not to the existence of a plan or Handoff.
