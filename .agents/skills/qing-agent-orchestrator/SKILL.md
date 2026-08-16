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
3. Select a model and reasoning effort only for the delegated task from options actually available in the desktop app. Never change the current parent model merely to route work.
4. Create a structured Handoff using [handoff-protocol.md](references/handoff-protocol.md) and validate it against the desktop-only [Handoff schema](schemas/handoff.schema.json). Show its exact ID, objective, paths, deliverables, tests, and requested operations.
5. Evaluate [safety-gates.md](references/safety-gates.md), then pause for approval of the exact Handoff ID and every operation-specific gate. Never infer approval from general consent.
6. After approval, execute within the declared paths using desktop tools or an internal child task. Keep results returning to the parent by default and report role, selected model, reasoning effort, phase, and status.
7. Review only concrete artifacts and test evidence with [reviewer-rules.md](references/reviewer-rules.md) and the desktop-only [Review schema](schemas/review.schema.json). On REVISE, stay within the approved scope and bounded iteration limit. Re-gate new operations.
8. Report final state, attempts, files, tests, evidence, unresolved limits, and whether any evidence was simulated.

## Desktop invariants

- Do not create an external process-backed execution path.
- Keep the parent conversation model unchanged; model routing applies to delegated tasks only.
- Preserve unrelated files and existing user changes.
- Never treat planning, mock output, or a live child task as proof of completion.
- Continue useful parent work while child tasks run, and provide concise progress updates during long work.
- Keep deletion, global installation, secrets, network side effects, messages, pushes, deployments, and production changes behind explicit operation gates.
