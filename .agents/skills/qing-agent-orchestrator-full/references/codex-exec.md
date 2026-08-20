# Guarded Codex CLI adapter

Use this adapter only after the full-edition recommendation was accepted.

## Dependency and approval sequence

1. Run scripts/qing.ps1 doctor; it checks availability and authentication but submits no task.
2. If missing or signed out, follow https://learn.chatgpt.com/docs/codex/cli. Obtain separate approval before global installation or configuration changes.
3. Keep executor.codexExec.enabled false by default.
4. Create and display a fresh exact Handoff and safety-gate report.
5. Require both --approve-handoff with that exact ID and --allow-real-execution. Add only explicitly approved gate IDs.

## Invocation rules

- Spawn with an argument array and shell disabled.
- Pass the capability-validated delegated model through `-m` and map router `reasoningEffort` to `model_reasoning_effort`. The documented process backend allows only minimal, low, medium, high, or xhigh; never send max or ultra without an explicit runtime capability update.
- Send the prompt over stdin and request JSONL plus a schema-validated final result.
- Use read-only or workspace-write, never unrestricted access.
- Keep workspace, sandbox, approval, output schema, timeout, and audit settings controlled by Relay rather than model candidates.
- Set high-level `executionOwner` to `Codex`; do not report concrete tool names as owners or create a per-tool ledger.
- After a real invocation error explicitly names the selected model ID and identifies that model as unknown, unsupported by the account/entitlement, missing metadata, or unavailable, try only the next healthy capability-valid candidate in the declared same-backend chain. Each bounded attempt must preserve the exact prompt, workspace, sandbox, environment/permissions, output schema, timeout, and output limit; a CLI profile change is not eligible for automatic gate reuse. Persist planned/actual pairs, each rejection reason, chain/attempts, and a complete unchanged-scope proof.
- Do not retry authentication, process/spawn, timeout, cancellation, output-limit, protocol, model-output-schema/schema-validation, unsafe/cross-backend, scope-changing, or exhausted-chain failures. Generic text that merely mentions a model is not an availability rejection. Do not fall through to an unrelated candidate.
- Bound runtime and output size, redact credentials, and preserve status/logs/cancel evidence.

Non-model nonzero exits, missing authentication, malformed output, timeout, cancellation, or missing final evidence are terminal failures for that run and are not model retries. An undeclared operation stops execution and returns to safety gating. The full archive bundles Relay only; it never bundles a Codex executable.
