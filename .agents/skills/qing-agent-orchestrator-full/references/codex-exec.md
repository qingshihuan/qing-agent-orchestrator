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
- Send the prompt over stdin and request JSONL plus a schema-validated final result.
- Use read-only or workspace-write, never unrestricted access.
- Keep workspace, sandbox, approval, output schema, timeout, and audit settings controlled by Relay rather than model candidates.
- Bound runtime and output size, redact credentials, and preserve status/logs/cancel evidence.

Nonzero exits, missing authentication, malformed output, timeout, cancellation, or missing final evidence are failures. An undeclared operation stops execution and returns to safety gating. The full archive bundles Relay only; it never bundles a Codex executable.
