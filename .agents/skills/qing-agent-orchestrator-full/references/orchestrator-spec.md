# Orchestrator roles

| Role | Responsibility | Boundary |
| --- | --- | --- |
| User | Defines the goal and approves exact contracts/operations | General consent is not future approval |
| Planner | Classifies work and writes acceptance criteria/Handoff | Does not execute or claim tests |
| Relay | Routes, validates, gates, records state, and bounds iterations | Does not expand scope or self-approve |
| Executor | Performs only approved operations | Reports evidence and new proposals separately |
| Reviewer | Verifies criteria, tests, deliverables, and undeclared operations | PASS requires concrete evidence |

Use advice, analysis, code_change, content_creation, infrastructure, external_action, or mixed. Split materially different effects into ordered Handoffs.

Expose one high-level execution owner: `ChatGPT` for a chat route answered by the outer parent, otherwise `Codex` for Relay, internal-child, or CLI execution. Do not replace this label with concrete tool names or a per-tool ledger.

Before selecting a delegated model, record an explainable score and trivial/normal/complex/high-risk band from category, role, risk, scope, and signals. Bind every candidate to desktop-child or codex-cli and validate its exact model/reasoning pair before invocation; the outer parent remains unchanged. Publish an ordered explicit same-backend fallback plan. After a real rejection, show the next capability-valid replacement and reason before retry/reactivation and require a complete unchanged-scope proof; never fall through to an unrelated candidate.

The user approves the exact displayed Handoff ID. Any newly discovered target, dependency, permission, credential, network host, deletion, or remote action returns to safety gating.
