# Handoff protocol 1.0

A Handoff is the Full-tier operation contract, not a universal prerequisite. Direct needs none. Lite uses a compact child brief with objective, allowed paths, constraints, deliverables and targeted checks. Qing decides the tier, not the user.

For Full validate `schemas/handoff.schema.json`. Include stable ID, objective/category, exact workspace and relative allowed paths, inputs, preservation constraints, acceptance criteria, every operation, deliverables, tests and bounded iterations. A plan is not permission and is not an extra approval step.

Native parent/children use the CURRENT effective host permissions and exact task authorization described in [safety-gates.md](safety-gates.md). Preserve the effect report. REQUIRE_APPROVAL means evaluate whether the existing task authorization and host grant cover that effect; it does not require a second Qing gate-ID prompt. Use the native host channel only for a genuine missing approval. DENY and unknown permission states never become grants.

Operations include read, write, delete, execute_tests, install_dependency, network_read, network_access, use_secret, external_message, git_commit, git_push, production_deploy, database_migration, global_write, purchase and scope_expansion. Describe read-only network reads separately from authenticated/private/state-changing access. The host enforces its current network and connector policies; a URL or repository entry does not prove authorization. Never place a secret value in the contract.

A new Full Handoff records orchestration tier, child/revision budgets and independent-review requirements. Keep the configured cap and at most maxRevisions + 1 execution iterations. Revisions preserve scope and still-valid authorization; changed target, data, privilege or effect requires renewed scope/host evaluation, not another confirmation when already covered. A host denial cannot be bypassed through another backend.
