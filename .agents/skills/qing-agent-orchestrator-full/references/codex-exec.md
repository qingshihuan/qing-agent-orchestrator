# Guarded Codex CLI adapter

Use only after the recommendation is accepted and the dependency/authentication check is ready.

Create a fresh Full Handoff and evaluate effects. Safe declared work does not need `--approve-handoff`; the flag remains accepted only for legacy compatibility and must match when supplied. Pass exact `--approve <gate-id>` values for consequential effects and always require `--allow-real-execution` before starting a real process.

Persist the Full child/revision contract. Before execution, reject a contract that exceeds current configuration and cap the Relay loop at the minimum of configured iterations, Handoff `maxIterations`, and `maxRevisions + 1`. Legacy `run` uses the same resolver; older Handoffs derive a current adaptive cap.

Use argument arrays with no shell, a capability-validated delegated model, documented reasoning settings, stdin prompt, schema-validated final output, bounded time/output, credential redaction, and read-only or workspace-write sandboxing. The archive never bundles an executable.

After an explicit selected-model availability rejection, try only the next healthy candidate in the internally validated same-backend chain with identical prompt, workspace, sandbox, permissions, schema, and limits. Do not preannounce fallback candidates. After a replacement is actually used, disclose the rejected pair, reason, and actual replacement while persisting planned/actual pairs, attempts, and scope proof. Do not retry authentication, process, timeout, cancellation, output-limit, protocol/schema, unsafe/cross-backend, scope-changing, or exhausted-chain failures.

## v0.11 approval ownership
The decision to use a process is automatic, not an extra consent screen. Dependency checks are read-only and host-controlled. An existing exact authorization can be conveyed by the trusted calling host without asking the user to repeat it; generated Handoffs never supply their own approvals. This standalone adapter has no native-session permission bridge: its execution opt-in, sandbox and scoped effect gates remain enforced. Prefer native subagents for normal work so the actual host applies its effective config directly.

## Node.js runtime
The optional standalone Relay is tested on Node.js 22, 24 and 26 (Windows/Linux); use the latest patch in one of these lines. Node.js 24 LTS is the recommended build/runtime baseline; 26 does not require a downgrade. The minimum engine declaration is 22, not a guarantee for untested future major versions. Native desktop workflows and the Standard edition do not need Node.js. Do not install or change the user's system runtime merely to load this skill.

## Experimental single-owner path
`node runtime/dist/src/cli.js execute-single task.json --protect SPEC.md --protect test_acceptance.py --config runtime/config/relay.user.json --allow-real-execution`
Requires enabled configured Codex, existing effect grants, a concrete validated Handoff/testPlan and an auditable Git workspace. It does not run a Planner. One worker completes the entire task; multi-agent tools are disabled for that invocation via `-c features.multi_agent=false`. The controller waits without model callbacks, runs the existing trusted acceptance/Git audits, verifies immutable-input SHA-256 and returns once. No automatic invocation retry or runtime fallback ladder. Normal worker-internal debugging remains possible.
An independent-review obligation returns INDEPENDENT_REVIEW_REQUIRED before execution; RuleBasedReviewer is only deterministic acceptance. A lease prevents concurrent cooperating single-owner runs of the same canonical workspace; crash leases are NOT automatically stolen. Confirm all old processes stopped before manual recovery. Other native/legacy tools are outside that lock. Existing sandbox/permissions are never expanded.
Usage reports only observed exec turn totals, not model-request counts. Missing/failed/preflight/outer-parent usage is marked incomplete; cost stays null. This is not a hard total-token or spend cap. Native parent request limits remain advisory, and actual account/CLI integration and speed/cost benefits need connected verification. The stable release remains v0.13 until that gate passes.
