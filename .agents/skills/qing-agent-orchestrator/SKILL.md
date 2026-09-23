---
name: qing-agent-orchestrator
description: Desktop-first Direct/Lite/Full orchestration with bounded delegation, minimal context, effect gates and evidence-based review. Use when Qing is invoked.
---

# Qing

Qing decides Direct/Lite/Full and the task model automatically; do not ask the user to choose a tier, agent or routine plan. Reassess only at phase boundaries or changed facts, not every tool call:
- Direct: safe single-scope work stays with the parent; zero children, no model allocation or Handoff approval.
- Lite: one Executor, targeted parent verification, at most one revision.
- Full: high-risk effects, cross-system work, real parallelism, release/deploy or explicit Full/Level 3; structured Handoff and independent Reviewer, two children and one revision by default. Only explicit bounded configuration overrides these limits.

De-escalate as work narrows. Retain pending independent-review obligations for unaccepted high-risk artifacts; restore Full at final acceptance. PARENT_ACTION_REQUIRED and PARENT_VERIFICATION_REQUIRED are not completion; never fabricate a Review.

## Conditional references
For clear Direct/Lite, do not preload references or schemas. Ambiguous routing or Full loads [orchestrator-spec.md](references/orchestrator-spec.md). For consequential or uncertain effects read [safety-gates.md](references/safety-gates.md). Native parent and children use the host's effective session permissions (including live overrides, config.toml layers and managed limits), not a second Qing approval system. Reuse exact user/task authorization and host grants; never ask again merely for a plan, agent, model, test or already-approved effect. on-request asks only when required; never means no new permission prompt, not unrestricted access. Unknown or denied permissions do not grant access. Do not edit security settings, fabricate approval IDs or switch backend to evade a denial. Preserve unrelated work and verify changed scope.
Full also loads [handoff-protocol.md](references/handoff-protocol.md), [reviewer-rules.md](references/reviewer-rules.md), [Handoff schema](schemas/handoff.schema.json) and [Review schema](schemas/review.schema.json). Never skip required review or verification to save tokens.

## Context and work budget
Keep tightly coupled work direct when delegation costs more than it saves. Delegate only useful separate work, never duplicate exploration. Send objective, relevant file ranges, constraints, acceptance criteria and tests, not the full conversation/repository. Revisions send unresolved findings and changed facts while retaining the safety contract. Reuse verification only for the same unchanged inputs, commands and environment; retest affected changes and run required full checks before release.
GPT-6 task-model policy: only gpt-6-luna, gpt-6-sol and gpt-6-astra. Direct creates no child. For delegated trivial work use Luna/low; normal work Luna/medium; complex planning Sol/medium; complex execution and independent review Sol/high. Astra is reserved for demanding work and explicit complex-task fallback, not ordinary-task retry. A failed task or test is not model unavailability. Preserve the revision budget; diagnose the failure instead of trying every model. Verify live host/CLI availability and disclose the actual pair. Never downgrade high-risk review to Luna merely to save credits. The parent model is unchanged. Before spawning show ownership, role/task and actual pair (or inherited/unconfirmed). Keep explicit same-backend fallback chains internal; disclose actual substitutions and re-gate changed scope.
Wait for meaningful events/results, not unchanged polling. One genuine no-progress timeout permits one takeover/replacement decision, not interrupt/reactivate loops. Report outcome, executionOwner (ChatGPT or Codex), artifacts, verification and limits. Plans, mocks and heartbeats are not completion; no per-tool ledger.
