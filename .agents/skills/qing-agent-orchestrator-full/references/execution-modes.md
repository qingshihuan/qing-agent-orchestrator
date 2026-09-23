# Automatic execution mode selection
Qing selects native parent/children by default. Complexity, writing code or duration alone do not justify another process. A genuine CLI-only/control/persistence need can select the process path automatically; do not add an accept/decline question just for routing. A stated refusal wins and is not asked again.

`dispatch` performs read-only dependency checks for an automatic process route. The routing function itself has no I/O. `--no-model-probe` prevents these checks and planning calls and returns `CLI_DEPENDENCY_CHECK_REQUIRED`; the host driver can remove that flag and continue with `--cli-response auto` under its existing permissions. The no-probe flag wins over auto/accept; decline still returns to native work without inspecting anything. `accept` and `decline` remain compatible overrides; automatic decisions are recorded as `auto-selected`, never as a user acceptance.

Missing runtime/authentication returns a setup requirement, not permission to install or log in. Continue native-capable work when possible. Installation, account use, new costs and broader effects need actual task/host authorization. A ready state or recommendation never starts the task; only a separately authorized execute invocation can do so.

Do not switch backend because a native action was denied. A separate CLI process does not magically inherit a desktop session's effective configuration. Its documented sandbox, execution opt-in and scoped effect gates remain intact; do not force never/full-access or disable user config to imitate a screenshot.
