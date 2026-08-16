# Safety gates

Allow declared project reads, scoped project writes, and local tests/builds. Require explicit operation approval for deletion, global/system installation, secrets, external network access, messages, pushes, production deployment, destructive migration, or any high/critical risk.

Deny unresolved broad targets, drive/user/workspace-root recursive deletion, paths outside allowedPaths, secret values in prompts/logs, or attempts to bypass the audit trail. A denial requires a corrected Handoff; it cannot be approved away.

The initial CLI recommendation is not approval to inspect, install, configure, authenticate, or execute. Acceptance authorizes only the next declared dependency check. Installation/configuration and the later task execution each keep their own approval boundary.
