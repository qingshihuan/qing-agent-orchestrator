# Orchestrator specification

## Roles

| Role | Responsibility | Must not do |
| --- | --- | --- |
| User | Defines the goal and grants explicit high-risk approvals | Be treated as having approved an operation they did not see |
| Planner | Clarifies intent, classifies the task, writes acceptance criteria and Handoff | Claim execution or test results |
| Relay | Validates schemas, evaluates gates, invokes the selected executor, limits loops, records state | Expand scope or bypass a gate |
| Executor | Performs only declared operations and returns structured evidence | Self-approve new risky operations |
| Reviewer | Checks evidence against acceptance criteria and tests | Pass based on confidence or prose alone |
| Human approver | Accepts or rejects the exact gated operation and target | Issue a blanket approval for unknown future actions |

## Trigger forms

Explicit forms include:

- `$qing-agent-orchestrator`
- `启动 Level 3 工作流`
- `使用工程代理模式`
- `把这个任务交给 Codex，并自动审查和修订`

Implicit activation is appropriate when a request needs multiple roles, structured handoff, risk gating, automatic review, or bounded revisions. Skip orchestration for a simple answer, translation, or isolated low-risk edit.

## Task classification

| Category | Typical goal | Default route |
| --- | --- | --- |
| `advice` | Explanation, design discussion, recommendation | Planner only |
| `analysis` | Diagnose or inspect without changes | Read-only executor, then reviewer if evidence matters |
| `code_change` | Implement, fix, refactor, or test code | Workspace-write executor + reviewer |
| `content_creation` | Create a document, report, design artifact, or asset | Artifact-capable executor + reviewer |
| `infrastructure` | Deploy, migrate, provision, or alter environments | Human-gated executor |
| `external_action` | Send, publish, purchase, notify, or change a remote system | Human-gated executor |
| `mixed` | More than one materially different category | Split into ordered Handoffs |

Classify by intended effect, not by nouns in the prompt. Split planning from execution when approval or missing input blocks only one portion.

Expose one high-level execution owner: `ChatGPT` for a chat route answered by the outer parent, otherwise `Codex` for Relay, internal-child, or delegated execution. This is an ownership label, not a concrete tool inventory; do not create a per-tool ledger.

Before selecting a delegated model, record an explainable score and trivial/normal/complex/high-risk band from category, role, risk, scope, and signals. A desktop model override applies only to the internal child through `{ model, reasoning_effort }`; the outer parent remains unchanged. Publish the explicit ordered same-backend fallback plan. A real spawn rejection may advance only to the next capability-valid pair after displaying the replacement and reason and supplying a complete unchanged-scope proof; no unrelated candidate may be selected implicitly.

## State machine

`DRAFT → VALIDATED → AWAITING_APPROVAL → GATED → EXECUTING → REVIEWING → PASS`

Alternative terminal or paused states are `DENIED`, `AWAITING_APPROVAL`, `MAX_ITERATIONS`, and `EXECUTOR_UNAVAILABLE`. A new operation discovered during execution returns the workflow to `GATED`.

The user must approve the exact Handoff ID after seeing its scope. Operation-specific gates are additional approvals, not substitutes for Handoff approval.
