# Native effect checks and host permissions

Qing classifies effects but does not add a second human-approval workflow to native parent/subagent calls. First establish the exact user-requested scope and use the host's CURRENT effective permissions. Reuse prior authorization only for the same operation, target, destination, data, scope and still-valid host grant. A plan, Handoff, model, child, local edit/test or already-authorized publish operation is not a reason to ask the same question again.

The host resolves config.toml layers, session flags, live permission changes, profiles, tool/connector controls and managed restrictions. A raw file or screenshot is not an executable authorization grant. Do not read or copy the whole config or credentials merely to route; do not rewrite approval_policy, sandbox or allowlists. Full filesystem access is not blanket authorization to publish, purchase, expose secrets or destroy unrelated work. Native connector permissions can differ from shell permissions.

For an already-authorized action the host permits, proceed without a Qing confirmation. If host approval is actually required, use its existing approval channel, not an additional Qing gate-ID request. on-request is not always-ask; never suppresses prompts but does not widen the sandbox. Unknown permission state must be resolved by the host or the affected action must stop. A denial, expired grant or unavailable approval never licenses retrying via another tool/backend or adding bypass flags. Clarify materially new/unresolved user intent only once; continue independent safe work.

Preserve denied targets, allowedPaths, independent review, tests and evidence. Model substitution alone creates no new authorization requirement when the full same-backend scope proof remains valid. Changes to operation, target, data, backend or privileges require renewed scope/policy evaluation, not necessarily a new prompt when already covered.

## Standalone Relay boundary

The following rules apply to separately launched Relay processes, not as duplicate native dialogs. The process has no trusted in-memory host approval bridge. Keep explicit scoped effect grants, disabled-real-execution defaults and --allow-real-execution. Do not accept a host-permitted string, generated gate IDs or a config.toml screenshot as a grant. The calling host may convey an already-authorized exact grant through the existing invocation; the model must not invent it.


Allow in-scope reversible project reads/writes, nondestructive local builds/tests, project-local dependencies, and `network_read` only on the exact reviewed hosts `developers.openai.com`, `docs.github.com`, `github.com`, `help.openai.com`, `learn.chatgpt.com`, `openai.com`, `platform.openai.com`, `raw.githubusercontent.com`, and `www.openai.com`. Arbitrary HTTPS is not proof of a public destination. Unlisted hosts, every IP literal, local/private names, URL userinfo, sensitive query names, fragments, authenticated/ambiguous access, and legacy `network_access` require an effect gate.

Require one concise approval bundle only for deletion, global/system installation or writes, secrets/private/authenticated access, external writes/messages/publication, Git push, production deployment, purchase/cost, destructive migration, material scope expansion, unlisted network destinations, or high/critical effects.

Deny broad/root deletion, path escape, embedded secrets, unresolved targets, and gate/audit bypass. Skip an unnecessary gated effect and continue safe work. Same-backend fallback may reuse gates only with a complete unchanged-scope proof; any backend, operation, path, sandbox, permission, or effect change requires a fresh gate.
