# Execution modes

Tier selection happens before backend selection. Direct and ordinary Lite work stay in the desktop app without probing the process backend.

The `start`/`prepare` command follows the same boundary: Direct returns immediately without model allocation or Planner activity; Lite returns a desktop single-Executor contract; only Full may invoke a local or connected Handoff Planner. `orchestration.mode=full` is the explicit force-Full configuration.

Recommend the optional backend only for an explicit CLI request, script/CI integration, scheduled/batch/unattended execution, app-close persistence, machine-readable status/logs/cancel, a CLI-only model/environment, or process isolation/queue needs. Coding complexity or duration alone is insufficient.

`desktop-native → cli-recommended → user choice`

- Decline → desktop fallback; do not repeat the prompt for this task.
- Accept → read-only dependency/authentication check.
- Missing/setup needed → setup-required; installation/configuration remains effect-gated.
- Ready → Full Handoff and safety evaluation; ALLOW becomes `FULL_EXECUTION_READY`, gated effects become `AWAITING_APPROVAL`.

No state transition starts task execution.
