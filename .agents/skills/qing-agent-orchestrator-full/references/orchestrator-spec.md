# Orchestrator roles

| Role | Responsibility | Boundary |
| --- | --- | --- |
| User | Defines the goal and approves exact contracts/operations | General consent is not future approval |
| Planner | Classifies work and writes acceptance criteria/Handoff | Does not execute or claim tests |
| Relay | Routes, validates, gates, records state, and bounds iterations | Does not expand scope or self-approve |
| Executor | Performs only approved operations | Reports evidence and new proposals separately |
| Reviewer | Verifies criteria, tests, deliverables, and undeclared operations | PASS requires concrete evidence |

Use advice, analysis, code_change, content_creation, infrastructure, external_action, or mixed. Split materially different effects into ordered Handoffs.

The user approves the exact displayed Handoff ID. Any newly discovered target, dependency, permission, credential, network host, deletion, or remote action returns to safety gating.
