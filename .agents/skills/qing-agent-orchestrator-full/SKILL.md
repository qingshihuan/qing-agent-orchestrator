---
name: qing-agent-orchestrator-full
description: Operate the full Qing Level 3 desktop-first Planner-Relay-Executor-Reviewer workflow with an optional guarded Codex CLI backend. Use for reviewed multi-step engineering work when the desktop app should handle normal tasks, while CI, scripts, scheduled or unattended runs, app-close persistence, machine-readable control, CLI-only configured models or environments, explicit process isolation, or an explicit CLI request may benefit from a CLI switch. Recommend the CLI only on those conditions, ask the user to accept or decline, and fall back to desktop when declined.
---

# Qing Agent Orchestrator Full

Use the desktop app normally. The optional process backend is an enhancement, not an activation dependency.

## Default desktop workflow

1. Resolve the exact project and classify the goal with [orchestrator-spec.md](references/orchestrator-spec.md).
2. Keep advice in the parent and delegate executable work to an internal child task by default. Open a separate visible task only when explicitly requested or needed for observation/isolation.
3. Score delegated work deterministically from category, role, risk, scope, and signals. Choose a capability-valid model/reasoning pair only for the delegated backend. For a desktop child, invoke `{ model, reasoning_effort }`; explicit spawn values override the configured subagent defaults. For the optional process backend, pass the selected model through `-m` and the documented reasoning setting. Never switch the current parent model.
4. Create and present a structured Handoff using [handoff-protocol.md](references/handoff-protocol.md).
5. Evaluate [safety-gates.md](references/safety-gates.md), wait for the exact Handoff and gate approvals, execute, then apply [reviewer-rules.md](references/reviewer-rules.md).

## Optional CLI decision

Read [execution-modes.md](references/execution-modes.md) when a goal may need automation or a separate process.

Do not check, install, authenticate, probe, or invoke the CLI during ordinary desktop work. Recommend it only for a documented reason code. Display the exact phrase:

> 建议切换 CLI 模式

Explain the concrete benefit and ask the user to accept or decline.

- If declined: record desktop-fallback-selected, suppress repeat prompts for this task, and continue all desktop-capable work. Clearly label any unattended, app-close-persistent, or backend-exclusive part that cannot be provided.
- If accepted: run scripts/qing.ps1 doctor. This is a dependency check only and must not submit a task.
  - If unavailable or unauthenticated, point to https://learn.chatgpt.com/docs/codex/cli. Obtain separate approval before any global installation or configuration change.
  - If ready, create a fresh CLI Handoff and safety-gate report. Wait for its exact approval before execution.

Only after the accepted branch, successful dependency check, exact Handoff approval, and all operation gates may scripts/qing.ps1 execute be used. Follow [codex-exec.md](references/codex-exec.md).

## Invariants

- Coding, complexity, or duration alone never triggers a CLI recommendation.
- Before creating, spawning, or reactivating every internal child task, display in commentary the child role/task, explicit model, reasoning effort, and that the parent model remains unchanged. If the host cannot explicitly select or verify the model or reasoning effort, state `inherited/unconfirmed` before delegation and never invent values; this also applies to follow-up and reactivated agents.
- A recommendation never starts a process.
- Declining always returns to desktop execution.
- The optional backend never bundles or impersonates a Codex executable.
- Desktop availability is host-advertised; process-backend availability remains entitlement-dependent until the existing bounded health probe passes. Capability drift fails closed and only explicit same-backend fallback chains are allowed.
- Preserve unrelated work, bounded revisions, evidence-based review, and visible progress.
