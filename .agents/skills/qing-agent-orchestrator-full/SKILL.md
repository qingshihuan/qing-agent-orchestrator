---
name: qing-agent-orchestrator-full
description: Desktop-first Direct/Lite/Full orchestration with bounded delegation, minimal context, effect gates and evidence-based review. Use when Qing is invoked.
---

# Qing

Reclassify the remaining phase each user turn and before delegation, revision or review:
- Direct: safe single-scope work stays with the parent; zero children, no model allocation or Handoff approval.
- Lite: one Executor, targeted parent verification, at most one revision.
- Full: high-risk effects, cross-system work, real parallelism, release/deploy or explicit Full/Level 3; structured Handoff and independent Reviewer, two children and one revision by default. Only explicit bounded configuration overrides these limits.

De-escalate as work narrows. Retain pending independent-review obligations for unaccepted high-risk artifacts; restore Full at final acceptance. PARENT_ACTION_REQUIRED and PARENT_VERIFICATION_REQUIRED are not completion; never fabricate a Review.

## Conditional references
For clear Direct/Lite, do not preload references or schemas. Ambiguous routing or Full loads [orchestrator-spec.md](references/orchestrator-spec.md). Destructive, external, secret, global/system or uncertain effects require [safety-gates.md](references/safety-gates.md) and exact approvals before acting. Reversible in-scope edits/builds/tests need no plan approval. Preserve unrelated work; re-gate changed effects or scope.
Full also loads [handoff-protocol.md](references/handoff-protocol.md), [reviewer-rules.md](references/reviewer-rules.md), [Handoff schema](runtime/schemas/handoff.schema.json) and [Review schema](runtime/schemas/review.schema.json). Never skip required review or verification to save tokens.

## Context and work budget
Delegate only useful separate work, never duplicate exploration. Send objective, relevant file ranges, constraints, acceptance criteria and tests, not the full conversation/repository. Revisions send unresolved findings and changed facts while retaining the safety contract. Reuse verification only for the same unchanged inputs, commands and environment; retest affected changes and run required full checks before release.
GPT-6 task-model policy: only gpt-6-luna, gpt-6-sol and gpt-6-astra. Direct creates no child. For delegated trivial work use Luna/low; normal work Luna/medium; complex planning Sol/medium; complex execution and independent review Sol/high. Astra is reserved for demanding work and explicit complex-task fallback, not ordinary-task retry. A failed task or test is not model unavailability. Preserve the revision budget; diagnose the failure instead of trying every model. Verify live host/CLI availability and disclose the actual pair. Never downgrade high-risk review to Luna merely to save credits. The parent model is unchanged. Before spawning show ownership, role/task and actual pair (or inherited/unconfirmed). Keep explicit same-backend fallback chains internal; disclose actual substitutions and re-gate changed scope.
Wait for meaningful events/results, not unchanged polling. One genuine no-progress timeout permits one takeover/replacement decision, not interrupt/reactivate loops. Report outcome, executionOwner (ChatGPT or Codex), artifacts, verification and limits. Plans, mocks and heartbeats are not completion; no per-tool ledger.

## Optional process backend
A documented process need alone justifies [execution-modes.md](references/execution-modes.md): CI, unattended scheduling, app-close persistence, machine-readable control, exclusive environment/model, isolation or explicit request. Show 建议切换 CLI 模式 and its benefit; obtain accept/decline before dependency checks. Decline continues desktop work without another prompt. Accept permits read-only doctor checks, not installation. Ready creates a fresh Full Handoff; real execution still requires --allow-real-execution and effect gates. Follow [codex-exec.md](references/codex-exec.md).
Prefer --compact. Read logs with --after <last-sequence> --limit 20 --compact; retain nextAfter and honor hasMore, never treating a page as the full journal. Use models probe --candidate <id> for only the needed candidate; reuse cached health, --force only for explicit refresh. No routine all-model probes.
