# Handoff protocol

Use a structured Handoff for Full; Direct needs none, Lite normally uses a compact child brief. Include stable ID, objective/category, exact workspace and relative allowed paths, constraints, acceptance criteria and owners, every operation/effect, deliverables, tests and bounded iterations. Preserve independent review and the minimum contract/config/Handoff iteration cap.

## Native parent and children
Follow the native policy in [safety-gates.md](safety-gates.md). The Handoff is a scope/evidence contract, not an approval dialog. Reuse exact user-task authorization and the host's current effective permissions. Preserve pending effect reports for host assessment; never convert unknown or denied authority to ALLOW. Ask only through the actual host channel for an uncovered requirement, not a separate Qing gate-ID question. Classify read-only network access separately from authenticated/private/state-changing access and respect the host's live policies.

## Standalone Relay
The separate process has no trusted desktop permission bridge. Use the existing process Schema, execution opt-in and exact effect gates. Project reads/writes/tests and network_read on the runtime's exact reviewed-host allowlist can pass local checks; unlisted/authenticated network access, deletion, secrets, external writes, push, deployment, destructive migration, global_write, purchase and scope_expansion retain their existing gates. An already-authorized exact grant may be conveyed by the trusted host caller; the Handoff must not manufacture it. This process policy is not a duplicate native approval screen.

New targets, data, permissions or effects require a revised scope contract and the applicable native-host or standalone evaluation. Never include secret values, expand the budget implicitly, or bypass a denial by changing backend.
