# Safety and human gates

Evaluate the exact operation, target, reason, and risk before execution. Approval IDs are scoped to a single Handoff operation and must not become blanket future permission.

Before operation gates, require approval of the complete Handoff by its exact ID. This approval is valid only after the user has seen the objective, workspace, allowed paths, deliverables, test plan, and requested operations. It does not approve any `REQUIRE_APPROVAL` operation automatically.

## Allow by default

Allow only when declared and confined to `workspace.allowedPaths`:

- reading scoped project files;
- writing scoped project files;
- running local tests and builds;
- installing project-local dependencies;
- creating a local commit when explicitly requested.

## Require human approval

Require approval for:

- deleting files or data;
- any push, especially protected branches such as `main`;
- production or public deployment;
- destructive or irreversible database migration;
- accessing a named secret or credential;
- network access to an external service;
- sending messages, publishing content, purchasing, or other external side effects;
- global/system software installation or writes outside the workspace;
- any operation marked `high` or `critical` risk.

On Windows, prefer D drive for system/global software installations when feasible. Project-local dependencies remain part of the chosen workspace.

## Deny without override

Deny and require a corrected Handoff for:

- recursive deletion of a drive root, home directory, workspace root, or unresolved broad path;
- file reads/writes/deletes outside `allowedPaths`;
- absolute file-operation targets or targets containing parent traversal, even when `allowedPaths` uses a wildcard;
- embedding secret values in prompts, logs, Handoffs, or review artifacts;
- bypassing, disabling, or falsifying the gate/reviewer/audit trail;
- an operation whose target cannot be resolved precisely.

Approval cannot convert `DENY` to `ALLOW`; the operation itself must be narrowed or removed.

## Re-gating

After execution, compare actual/proposed operations with the Handoff. Stop and re-gate any new operation before it occurs. Do not accept an executor's self-approval.
