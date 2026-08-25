# Effect-based safety gates

Allow in-scope reversible project reads/writes, nondestructive local builds/tests, project-local dependencies, and `network_read` only on the exact reviewed hosts `developers.openai.com`, `docs.github.com`, `github.com`, `help.openai.com`, `learn.chatgpt.com`, `openai.com`, `platform.openai.com`, `raw.githubusercontent.com`, and `www.openai.com`. Arbitrary HTTPS is not proof of a public destination. Unlisted hosts, every IP literal, local/private names, URL userinfo, sensitive query names, fragments, authenticated/ambiguous access, and legacy `network_access` require an effect gate.

Require one concise approval bundle only for deletion, global/system installation or writes, secrets/private/authenticated access, external writes/messages/publication, Git push, production deployment, purchase/cost, destructive migration, material scope expansion, unlisted network destinations, or high/critical effects.

Deny broad/root deletion, path escape, embedded secrets, unresolved targets, and gate/audit bypass. Skip an unnecessary gated effect and continue safe work. Same-backend fallback may reuse gates only with a complete unchanged-scope proof; any backend, operation, path, sandbox, permission, or effect change requires a fresh gate.
