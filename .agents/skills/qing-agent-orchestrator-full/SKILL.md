---
name: qing-agent-orchestrator-full
description: Operate the full Qing Level 3 desktop-first Planner-Relay-Executor-Reviewer workflow with an optional guarded Codex CLI backend. Use for reviewed multi-step engineering work when the desktop app should handle normal tasks, while CI, scripts, scheduled or unattended runs, app-close persistence, machine-readable control, CLI-only configured models or environments, explicit process isolation, or an explicit CLI request may benefit from a CLI switch. Recommend the CLI only on those conditions, ask the user to accept or decline, and fall back to desktop when declined.
---

# Qing Agent Orchestrator Full

Use the desktop app normally. The optional process backend is an enhancement, not an activation dependency.

## Default desktop workflow

1. Resolve the exact project and classify the goal with [orchestrator-spec.md](references/orchestrator-spec.md).
2. Keep advice in the parent and delegate executable work to an internal child task by default. Open a separate visible task only when explicitly requested or needed for observation/isolation.
3. Before creating each desktop child, read and follow [desktop-model-routing.md](references/desktop-model-routing.md). Select from the child-creation tool's currently exposed candidates, record the route decision, and explicitly pass both `model` and `reasoning_effort`. Never switch the current parent model. Silent inheritance is prohibited; use the documented `inherit-fallback` only when the active desktop backend exposes no usable model and reasoning-effort overrides, and disclose it to the user. If overrides exist but no legal candidate exists, stop and request user direction before creating any child.
4. Create and present a structured Handoff using [handoff-protocol.md](references/handoff-protocol.md).
5. Evaluate [safety-gates.md](references/safety-gates.md), wait for the exact Handoff and gate approvals, execute, then apply [reviewer-rules.md](references/reviewer-rules.md).

## Optional CLI decision

Read [execution-modes.md](references/execution-modes.md) when a goal may need automation or a separate process.

Do not check, install, authenticate, probe, or invoke the CLI during ordinary desktop work. Recommend it only for a documented reason code. Display the exact phrase:

> 建议切换 CLI 模式

Explain the concrete benefit and ask the user to accept or decline.

- If declined: record desktop-fallback-selected, suppress repeat prompts for this task, and continue all desktop-capable work. Clearly label any unattended, app-close-persistent, or backend-exclusive part that cannot be provided.
- If accepted: select the platform launcher, then run its `doctor` command. Use `scripts/qing.ps1 doctor` on Windows and `scripts/qing.sh doctor` on Linux or macOS. This is a dependency check only and must not submit a task.
  - If unavailable or unauthenticated, point to https://learn.chatgpt.com/docs/codex/cli. Obtain separate approval before any global installation or configuration change.
  - If ready, create a fresh CLI Handoff and safety-gate report. Wait for its exact approval before execution.

Only after the accepted branch, successful dependency check, exact Handoff approval, and all operation gates may the selected launcher's `execute` command be used. Follow [codex-exec.md](references/codex-exec.md).

## Invariants

- Coding, complexity, or duration alone never triggers a CLI recommendation.
- A recommendation never starts a process.
- Declining always returns to desktop execution.
- The optional backend never bundles or impersonates a Codex executable.
- Preserve unrelated work, bounded revisions, evidence-based review, and visible progress.
