# Handoff protocol

Use a structured Handoff for Full. Direct needs none; Lite normally uses a compact child brief.

Include the stable ID, objective/category, exact workspace and relative allowed paths, inputs/constraints, acceptance criteria and owners, every operation/effect, deliverables, tests, and bounded iterations. A valid Handoff whose safety outcome is ALLOW proceeds without separate plan approval.

Operations include project reads/writes/tests plus `network_read` only for the exact reviewed-host allowlist in [safety-gates.md](safety-gates.md). Unlisted network targets, deletion, `network_access`, secrets, external messages, pushes, deployment, destructive migration, `global_write`, `purchase`, and `scope_expansion` remain effect-gated. New Handoffs persist tier/child/revision budgets; `execute` and legacy `run` enforce the minimum contract/config/Handoff iteration cap. A revision that adds targets, authority, permissions, or effects must re-enter gating.
