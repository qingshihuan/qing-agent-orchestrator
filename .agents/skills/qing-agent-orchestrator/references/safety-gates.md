# Effect-based safety gates

The user's request authorizes safe work inside its stated scope. Do not ask for approval merely because a task has a plan, Handoff, child, model, local edit, or local test.

Allow declared project reads, reversible scoped writes, nondestructive local builds/tests, project-local dependencies, and `network_read` only when the runtime recognizes an exact reviewed documentation host. Arbitrary HTTPS syntax cannot prove a public destination: unlisted hosts, every IP literal, local/private names, URL userinfo, sensitive query names, fragments, authenticated/ambiguous/state-changing access, and legacy `network_access` require an effect gate. The runtime allowlist is `developers.openai.com`, `docs.github.com`, `github.com`, `help.openai.com`, `learn.chatgpt.com`, `openai.com`, `platform.openai.com`, `raw.githubusercontent.com`, and `www.openai.com`.

Require one concise approval bundle for the exact consequential effects that are actually needed: deletion, global/system writes or installation, secrets/private data, authenticated network access, external messages or publication, Git push, production deployment, purchase/cost, destructive migration, material scope expansion, or any high/critical operation. Model substitution alone is not an effect gate when the internally validated same-backend chain and complete unchanged-scope proof remain valid.

Deny unresolved broad deletion, drive/user/workspace-root deletion, paths outside `allowedPaths`, parent traversal, embedded secrets, gate/audit bypass, or an unresolved target. A denial must be corrected rather than approved.

If a gated effect becomes unnecessary, skip it and continue other safe work. If a selected model is rejected, use only the next internally validated capability-valid same-backend pair. Do not preannounce it; after the replacement is actually used, report the rejected pair, reason, and actual replacement. Re-gate only when backend, operation, path, sandbox, permission, or effect changes.
