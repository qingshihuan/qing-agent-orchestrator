# Handoff protocol 1.0

A Handoff is the Full-tier operation contract, not a universal prerequisite. Direct needs none. Lite normally uses a compact child brief containing objective, allowed paths, constraints, deliverables, and targeted checks.

For Full, validate `schemas/handoff.schema.json`. Include a stable ID, objective/category, exact workspace and relative allowed paths, inputs, preservation constraints, acceptance criteria, every requested operation, deliverables, tests, and a bounded iteration count. A valid safe Handoff may proceed without separate approval; only `REQUIRE_APPROVAL` effects pause.

Supported operations are `read`, `write`, `delete`, `execute_tests`, `install_dependency`, `network_read`, `network_access`, `use_secret`, `external_message`, `git_commit`, `git_push`, `production_deploy`, `database_migration`, `global_write`, `purchase`, and `scope_expansion`.

Use `network_read` only for a read-only HTTPS URL on the exact reviewed-host allowlist in [safety-gates.md](safety-gates.md), without userinfo, sensitive query names, a fragment, or IP/private-network access. Unlisted hosts require an effect gate; use `network_access` for authenticated, private, ambiguous, or state-changing interaction. Never place a secret value in the contract.

A new Full Handoff carries `orchestration` tier, child budget, Reviewer mode, and revision budget. Runtime iterations may not exceed `maxRevisions + 1` or the current configured/Handoff cap; a legacy contract without this field derives the current adaptive limit. A revision preserves the objective and approved effects. New targets, permissions, credentials, dependencies, external effects, or material scope require an updated contract and a fresh effect gate.
