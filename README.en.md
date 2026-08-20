# Qing-Agent-Orchestrator

[简体中文](README.md) · [Editions](docs/editions.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

**Let the model that understands, plans, and communicates well clarify the work; let Codex handle code and engineering execution.**

Qing-Agent-Orchestrator turns planning, delegation, model selection, approval, execution, and review inside the ChatGPT/Codex desktop workflow into one controlled process. It is designed first for people already using an OpenAI subscription in the desktop client: the default path needs no OpenAI API key, and writing code, handling a complex task, or taking a long time is not by itself a reason to move to the CLI.

## The problems it solves

- **Context gets lost between tools.** Requirements, planning, implementation, testing, and review often live in separate tasks.
- **Model choice becomes guesswork.** Heavy models waste time on small work, while difficult work fails when reasoning is too shallow.
- **Approval is ambiguous.** “Continue” should not silently authorize software installation, file replacement, a Git push, or a public post.
- **Completion claims lack evidence.** A model report, heartbeat, mock, or live process does not prove that the tests passed.
- **CLI workflows are overused.** Normal desktop work should not require another runtime, background process, or setup burden.

Qing separates three routing decisions:

1. **Task routing** decides whether the parent task can answer directly, an internal child task should execute, or a structured engineering workflow is required.
2. **Execution-mode routing** stays desktop-native by default and recommends the CLI only for CI, scheduled or unattended work, app-close persistence, machine-readable control, or explicit process isolation.
3. **Model routing** chooses an actually available model and reasoning effort for the delegated role without changing the parent task model.

Complexity is an explainable score rather than a fast/complex toggle. It combines category, Planner/Executor/Reviewer role, risk, single/multi-step/cross-system scope, and observed signals into `trivial | normal | complex | high-risk`. An ordinary single-file code execution stays normal; multi-step, cross-system, and high-risk work escalate.

Every candidate is bound to `desktop-child` or `codex-cli`. The internal `collaboration.spawn_agent` interface advertises only `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.4`, with exact per-model effort validation. An internal desktop child receives `{ model, reasoning_effort }`; explicit spawn values override `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort`. The CLI receives `-m` and `model_reasoning_effort`; the documented CLI path sends only `minimal|low|medium|high|xhigh`, never `max/ultra`. Overrides apply only to delegated backends and never switch the parent. `gpt-5.3-codex-spark` remains only as an entitlement-probed CLI candidate listed by the official Codex models documentation; API catalog evidence is not desktop-child entitlement.

Availability is a current host/documentation snapshot and can drift with version, account, or entitlement. CLI candidates must pass the existing health probe, and fallback is restricted to explicit same-backend chains. ChatGPT/Codex subscription access is not Responses API entitlement; this project has no provider URL, token, or API adapter.

## Workflow

```text
User goal
  → Planner: create an exact Handoff
  → Approval: approve the contract and required gates
  → Executor: perform only approved operations
  → Evidence: capture tests, files, Git state, and runtime events
  → Reviewer: PASS / REVISE / HUMAN_REVIEW
  → Return the result to the parent task
```

A Handoff declares the objective, workspace, allowed paths, operations, deliverables, acceptance criteria, and test plan. A new path, dependency, permission, or external action returns to gating instead of inheriting vague consent.

## Choose an edition

| Edition | Best for | Default execution | CLI |
| --- | --- | --- | --- |
| **Desktop Standard** `qing-agent-orchestrator` | Most desktop-client users | Parent task or internal child task | No launcher, runtime, or CLI dependency |
| **Full** `qing-agent-orchestrator-full` | Users who also need CI, scheduling, batching, isolation, or machine-readable control | Still desktop-first | Optional, only after an explicit reason and user acceptance |

Choose **Desktop Standard** if you are unsure.

## Install

Download one archive from the Release:

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`

Extract it so the final folder matches the skill name:

```text
%USERPROFILE%\.agents\skills\qing-agent-orchestrator\
```

or:

```text
%USERPROFILE%\.agents\skills\qing-agent-orchestrator-full\
```

The skill can also live under a project's `.agents/skills/` directory. Start a new desktop task after installation and invoke the corresponding skill.

Checksums are recorded in [`artifacts/SHA256SUMS.txt`](artifacts/SHA256SUMS.txt). The standard archive has no scripts or runtime. The full archive contains the optional Relay but never bundles or impersonates `codex.exe`.

## Quick start

Desktop Standard:

```text
$qing-agent-orchestrator
Goal: review the login flow, propose a plan, implement it after approval, and run the tests.
```

Full edition:

```text
$qing-agent-orchestrator-full
Goal: integrate repository checks into CI and expose machine-readable status.
```

Normal work stays in the parent desktop task. Executable work uses an internal child task by default and returns its result to the parent. A new visible task is created only when the user asks for it or independent observation or isolation is genuinely required.

## When the CLI may be recommended

The full edition may recommend the CLI only for:

- an explicit CLI request;
- scripts or CI;
- scheduled, batch, or unattended work;
- work that must continue after the desktop app closes;
- machine-readable `status/logs/cancel` or JSONL;
- a CLI-only model, profile, or environment;
- explicit process isolation, a task queue, or a separate process.

Code, complexity, and duration alone do not trigger it. Declining returns to desktop execution and suppresses repeated prompts for the task. Accepting starts only a dependency check; installation, configuration, and real execution remain separate approval boundaries.

## Safety and evidence

- Exact Handoff approval is separate from operation-specific gates.
- Deletion, global installation, secrets, external messages, pushes, deployments, and destructive migrations require explicit approval.
- Allowed paths, before/after Git snapshots, and undeclared changes are audited.
- Declared tests are executed independently by the Relay parent and bound to the current run, Handoff, and iteration.
- Mock, dry-run, heartbeat, and process liveness never count as real completion.
- The Reviewer uses trusted evidence from the current iteration.

## Current boundary

`v0.3.0` includes the two editions, task/execution/model routing, structured contracts, safety gates, Relay and RunStore evidence, rule-based review, an observable control plane, and an optional real `codex exec` adapter that is disabled by default.

It does not yet include an OpenAI API / Codex SDK dual-agent adapter, native approval buttons, a persistent cross-process service queue, a separate user-visible model picker, or a connected CLI write E2E. SDK/API integration is planned as an optional branch and will not replace the desktop-first mainline. See the [roadmap](docs/roadmap.md).

## Development

Node.js 18 or newer is required:

```powershell
npm install
npm run typecheck
npm test
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator-full
powershell -NoProfile -File scripts/package-skill-editions.ps1 -Validate
```

The packaging script writes the final ZIPs before generating `artifacts/SHA256SUMS.txt`. `-Validate` requires exactly both archive names and recomputes their hashes, then compares the full edition's exact inventory and every file SHA-256 with the declared skill sources, `dist/src`, schemas, and generated runtime config/package. File counts are not used as a content proxy.

Read [CHANGELOG](CHANGELOG.md), [CONTRIBUTING](CONTRIBUTING.md), and [SECURITY](SECURITY.md) before contributing.

## License

[MIT](LICENSE) © Qing-Agent-Orchestrator contributors
