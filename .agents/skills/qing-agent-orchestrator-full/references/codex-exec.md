# Guarded Codex CLI adapter

Use only after the recommendation is accepted and the dependency/authentication check is ready.

Create a fresh Full Handoff and evaluate effects. Safe declared work does not need `--approve-handoff`; the flag remains accepted only for legacy compatibility and must match when supplied. Pass exact `--approve <gate-id>` values for consequential effects and always require `--allow-real-execution` before starting a real process.

Persist the Full child/revision contract. Before execution, reject a contract that exceeds current configuration and cap the Relay loop at the minimum of configured iterations, Handoff `maxIterations`, and `maxRevisions + 1`. Legacy `run` uses the same resolver; older Handoffs derive a current adaptive cap.

Use argument arrays with no shell, a capability-validated delegated model, documented reasoning settings, stdin prompt, schema-validated final output, bounded time/output, credential redaction, and read-only or workspace-write sandboxing. The archive never bundles an executable.

After an explicit selected-model availability rejection, try only the next healthy candidate in the internally validated same-backend chain with identical prompt, workspace, sandbox, permissions, schema, and limits. Do not preannounce fallback candidates. After a replacement is actually used, disclose the rejected pair, reason, and actual replacement while persisting planned/actual pairs, attempts, and scope proof. Do not retry authentication, process, timeout, cancellation, output-limit, protocol/schema, unsafe/cross-backend, scope-changing, or exhausted-chain failures.
