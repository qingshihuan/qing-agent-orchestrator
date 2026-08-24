# Qing-Agent-Orchestrator

[简体中文](README.md) · [v0.5.0 release notes](docs/release-notes-v0.5.0.md) · [Editions](docs/editions.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

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

Routes and final reports expose one high-level owner only: `executionOwner: ChatGPT` for a direct outer-parent answer, and `executionOwner: Codex` for Relay, internal-child, or CLI execution. This does not require concrete tool names or a per-tool ledger.

Complexity is an explainable score rather than a fast/complex toggle. It combines category, Planner/Executor/Reviewer role, risk, single/multi-step/cross-system scope, and observed signals into `trivial | normal | complex | high-risk`. An ordinary single-file code execution stays normal; multi-step, cross-system, and high-risk work escalate.

Every candidate is bound to `desktop-child` or `codex-cli`. Desktop candidates continue to use the capability snapshot advertised by the host. An internal child receives `{ model, reasoning_effort }`; explicit values affect only the delegated backend and never change the parent model. The CLI receives `-m` and `model_reasoning_effort`. Configuration may express `minimal|low|medium|high|xhigh|max|ultra`, but the installed `codex debug models --bundled` catalog is authoritative for model slugs, reasoning levels, and minimum client versions. A CLI candidate must also pass a bounded, read-only, structured account-entitlement probe, so a catalog-valid but account-unavailable pair never becomes healthy.

Availability is a current host/runtime snapshot and can drift with version, account, or entitlement. Ordinary and high-risk work both use a completion-first policy: CLI candidates must pass the existing health probe, while a rejected desktop spawn may continue only after the parent displays the replacement pair and reason and only along an explicit, capability-valid, same-backend fallback chain. Exhaustion fails closed and never selects an unrelated candidate. A real CLI invocation retries only when the error explicitly names the selected model ID and says that model is unknown, unsupported by the account/entitlement, missing metadata, or unavailable. Authentication, process, timeout, cancellation, output-limit, protocol, model-output-schema, and ordinary failures are not retried. Every substitution emits `executionOwner: Codex`, planned/actual pairs, reason, chain and attempts, plus a complete scope proof; missing or incomplete proof requires a new gate. ChatGPT/Codex subscription access is not Responses API entitlement; this project has no provider URL, token, or API adapter.

## v0.5.0 highlights

- **The installed catalog is authoritative:** CLI model slugs, reasoning levels, and minimum client versions come from the current Codex bundled catalog rather than a permanent repository table.
- **Two-layer health validation:** a catalog-valid pair must still pass a bounded read-only entitlement probe before real execution can start.
- **Cross-platform path fail-closure:** wildcards no longer admit POSIX, Windows, UNC absolute paths, or parent traversal.
- **Four-platform continuous verification:** Windows and Ubuntu on Node.js 18 and 22 run typechecking and the complete test suite.
- **Provable release artifacts:** the Full runtime, both ZIPs, extracted per-file contents, and SHA-256 manifests are independently checked by CI and the release workflow.

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
- Gates cover operational effects, not model identity: an explicit same-backend substitution needs no new gate only when a complete explicit proof confirms operations, allowed paths, sandbox, permissions, and effects are unchanged; missing/incomplete proof or a backend/scope change must be re-approved.
- Deletion, global installation, secrets, external messages, pushes, deployments, and destructive migrations require explicit approval.
- Allowed paths, before/after Git snapshots, and undeclared changes are audited.
- Declared tests are executed independently by the Relay parent and bound to the current run, Handoff, and iteration.
- Mock, dry-run, heartbeat, and process liveness never count as real completion.
- The Reviewer uses trusted evidence from the current iteration; the final report labels ownership only as `ChatGPT`/`Codex` and discloses the actual model substitution or states that none occurred.

## Current boundary

`v0.5.0` includes both editions; task and execution-mode routing; delegated model routing; installed Codex catalog validation for CLI model slugs, reasoning levels, and minimum client versions; the subsequent bounded entitlement probe; the sole `executionOwner: ChatGPT | Codex` contract; completion-first explicit same-backend fallback; same-scope high-risk gate reuse; fail-closed rejection classification; cross-platform absolute-path and traversal protection; structured contracts; Relay, RunStore, rule-based review, and the observable control plane; the disabled-by-default real `codex exec` adapter; four-platform CI; generated-runtime drift detection; content-verified installable archives; and an automated GitHub Release pipeline.

It still does not include an OpenAI API / Codex SDK dual-agent adapter, native approval buttons, a persistent cross-process service queue, a separate user-visible model picker, a connected CLI write E2E, or a guarantee that any particular account is entitled to a specific model pair. SDK/API integration remains an optional future branch and will not replace the desktop-first mainline. See the [roadmap](docs/roadmap.md).

This release adds verifiable runtime-catalog, client-version, account-preflight, and publication layers. It does not treat catalog parsing or controlled fake-runner tests as a new connected CLI success; the target installation must still pass its real health probe. See the [v0.5.0 release notes](docs/release-notes-v0.5.0.md). Historical details remain in the [v0.4.0](docs/release-notes-v0.4.0.md) and [v0.3.0](docs/release-notes-v0.3.0.md) notes.

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
