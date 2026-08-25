# Adaptive orchestration specification

## Tier decision

Choose the smallest tier that preserves quality and safety.

| Tier | Use when | Child budget | Verification | Revision budget |
| --- | --- | ---: | --- | ---: |
| Direct | Advice, read-only reasoning, or safe reversible single-scope project work | 0 | Parent, only when executable | 0 |
| Lite | Bounded multi-step or complex work that benefits from one delegation | 1 Executor | Parent targeted verification | 1 |
| Full | High/critical risk, external/global effects, cross-system scope, genuinely independent parallel work, release/deploy, or explicit Full/Level 3 | Configured bounded budget | Independent Reviewer | Configured, never above 5 iterations |

Risk and effects take precedence over complexity. A long prompt alone does not justify Full. Several sequential steps alone do not justify several children. Escalate Direct → Lite or Lite → Full only when new evidence changes these conditions.

When a Full Handoff is created, persist the chosen child/revision budgets. Runtime validation rejects a contract that exceeds current configuration, and the Relay iteration loop uses `min(relay.maxIterations, handoff.maxIterations, maxRevisions + 1)`. Legacy Handoffs remain readable but derive this cap from current routing.

## Roles and ownership

The parent classifies and owns Direct work. Lite uses one Executor and parent verification. Full separates Planner, Executor, and Reviewer responsibilities. No role may expand scope or approve its own new effect.

Expose only high-level ownership: `ChatGPT` for outer-parent work and `Codex` for delegated execution. Select a delegated model only after the tier grants a child budget. Keep the parent model unchanged as an internal invariant. Retain the ordered same-backend fallback chain internally and disclose it only when a substitution actually occurs.

## Result states

- `DIRECT_EXECUTION_REQUIRED`: parent proceeds; no child or model allocation.
- `LITE_EXECUTION_REQUIRED`: one Executor may proceed; parent verifies.
- `FULL_EXECUTION_READY`: Full contract is safe and may proceed without plan approval.
- `AWAITING_APPROVAL`: only named consequential effects are paused.
- `DENIED`: contract must be corrected; approval cannot override it.

New permissions, paths, external effects, or material scope return only the affected portion to gating.
