---
name: qing-agent-orchestrator
description: Operate the Qing Level 3 Planner-Relay-Executor-Reviewer workflow entirely inside the ChatGPT/Codex desktop app, including task classification, structured Handoffs, exact approval, safety gates, internal child-task delegation, model and reasoning selection for delegated work, evidence review, and bounded revisions. Use when the user says "启动 Level 3", "青-Agent-Orchestrator", "工程代理模式", asks ChatGPT and Codex to collaborate, or wants a reviewed multi-step implementation without an external process backend. Do not use for simple answers or isolated low-risk edits that do not benefit from orchestration.
---

# Qing Agent Orchestrator Desktop

Use the desktop app as the complete Planner → Relay → Executor → Reviewer environment. Planning and execution remain separate even though they occur in one visible parent task.

## Workflow

1. Resolve the exact target project and classify the goal using [orchestrator-spec.md](references/orchestrator-spec.md).
2. Decide whether the parent can answer directly or should delegate:
   - Answer advice and simple read-only reasoning in the parent.
   - Use an internal child task for executable or independently reviewable work.
   - Create a separate user-visible task only when the user explicitly asks for one or needs distinct observation/isolation.
   - Set the high-level `executionOwner` to exactly `ChatGPT` for a chat/outer-parent answer and exactly `Codex` for Relay or internal-child execution. Do not replace this with a concrete tool name or a per-tool ledger.
3. Score delegated work deterministically from category, role, risk, scope, and observed signals. Select a model/reasoning pair only from the current desktop host capability list. Pass an explicit internal-child payload `{ model, reasoning_effort }`; explicit spawn values override `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort`. Never change the current parent model merely to route work.
4. Create a structured Handoff using [handoff-protocol.md](references/handoff-protocol.md) and validate it against the desktop-only [Handoff schema](schemas/handoff.schema.json). Show its exact ID, objective, paths, deliverables, tests, and requested operations.
5. Evaluate [safety-gates.md](references/safety-gates.md), then pause for approval of the exact Handoff ID and every operation-specific gate. Never infer approval from general consent.
6. After approval, execute within the declared paths through the approved desktop path. Keep results returning to the parent by default and report `executionOwner`, role, selected model, reasoning effort, phase, and status. If a real spawn rejects the pair, continue only with the next capability-valid pair in the displayed same-backend fallback plan.
7. Review only concrete artifacts and test evidence with [reviewer-rules.md](references/reviewer-rules.md) and the desktop-only [Review schema](schemas/review.schema.json). On REVISE, stay within the approved scope and bounded iteration limit. Re-gate new operations.
8. Report final state, high-level `executionOwner`, attempts, files, tests, evidence, unresolved limits, whether any evidence was simulated, and either the planned/actual fallback audit or that no substitution occurred. Ownership is only `ChatGPT` or `Codex`; never require a concrete tool name or per-tool ledger.

## Desktop invariants

- Do not create an external process-backed execution path.
- Before creating, spawning, or reactivating every internal child task, display in commentary the child role/task, explicit model, reasoning effort, and that the parent model remains unchanged. If the host cannot explicitly select or verify the model or reasoning effort, state `inherited/unconfirmed` before delegation and never invent values; this also applies to follow-up and reactivated agents.
- Keep the parent conversation model unchanged; model routing applies to delegated tasks only.
- Treat advertised model availability as a host snapshot that can drift with entitlement. For ordinary and high-risk work alike, if spawning rejects a pair, show the replacement model/reasoning pair and rejection reason before retrying or reactivating, then record the planned pair, actual pair, ordered chain, and attempts. Follow only the displayed explicit capability-valid same-backend chain; fail closed when it is exhausted.
- Model identity is not an operation gate. Reuse existing approvals only when an explicit complete proof confirms backend, requested operations, allowed paths, sandbox, permissions, and effects are unchanged. Missing or incomplete proof, a backend change, or any new permission/effect returns to a fresh gate.
- Preserve unrelated files and existing user changes.
- Never treat planning, mock output, or a live child task as proof of completion.
- Continue useful parent work while child tasks run, and provide concise progress updates during long work.
- Keep deletion, global installation, secrets, network side effects, messages, pushes, deployments, and production changes behind explicit operation gates.
