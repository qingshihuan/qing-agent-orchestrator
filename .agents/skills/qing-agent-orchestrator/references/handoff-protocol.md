# Handoff protocol 1.0

A Handoff is the complete contract between Planner and Executor. Validate it before evaluating risk or invoking an executor.

## Required fields

| Field | Meaning |
| --- | --- |
| `version` | Literal `1.0` |
| `id` | Stable task identifier |
| `title` | Short human-readable name |
| `objective` | Observable outcome, not an implementation wish |
| `category` | One classification from the orchestrator specification |
| `workspace.root` | Exact project directory; may be outside the Relay installation but must not be a drive or user-profile root |
| `workspace.allowedPaths` | Workspace-relative paths only; absolute paths and parent traversal are invalid |
| `inputs` | Named files, images, URLs, text, or other supplied material |
| `constraints` | Preservation rules, exclusions, stack limits, and non-goals |
| `acceptanceCriteria` | Stable IDs, testable descriptions, and verification methods |
| `requestedOperations` | Every planned read, write, command, network, remote, secret, or destructive action |
| `deliverables` | Expected artifact paths and descriptions |
| `testPlan` | Exact verification commands or checks expected from the executor |
| `maxIterations` | Integer from 1 through 5 |

Use `schemas/handoff.schema.json` as the machine-readable source of truth in this project.

In the desktop standard edition, `verificationOwner` is one of `parent`, `internal-child`, or `hybrid`. It assigns evidence responsibility inside the desktop task and does not describe an operating-system process, Relay event stream, or external execution backend.

## Operation declaration

Each operation contains `type`, `target`, `reason`, and `risk`. Supported types are:

`read`, `write`, `delete`, `execute_tests`, `install_dependency`, `network_access`, `use_secret`, `external_message`, `git_commit`, `git_push`, `production_deploy`, and `database_migration`.

Declare targets narrowly. `write: src/widget/**` is reviewable; `write: entire machine` is not. Never place a secret value in the Handoff—refer to its approved environment-variable or secret-store name.

## Revision Handoff

A revision keeps the original objective and scope, then appends the Reviewer's concrete instructions. If a revision needs a new target, permission, credential, dependency, network host, or remote action, update `requestedOperations` and re-run the safety gate before execution.
