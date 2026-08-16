# Execution modes

Task routing and process-backend routing are independent. Desktop is always the default.

| Condition | Standard edition | Full edition |
| --- | --- | --- |
| Advice or analysis | Parent desktop task | Parent desktop task |
| Normal code/content work | Internal desktop child | Internal desktop child |
| Complex or long interactive work | Internal desktop child | Internal desktop child |
| User requests a visible task | Separate visible desktop task | Separate visible desktop task |
| Explicit CLI request | Continue desktop | Recommend CLI |
| Script or CI | Continue desktop | Recommend CLI |
| Scheduled, batch, or unattended run | Continue desktop | Recommend CLI |
| Must continue after app closes | Continue desktop and disclose limitation | Recommend CLI |
| Machine-readable status/logs/cancel | Continue desktop and disclose limitation | Recommend CLI |
| CLI-only configured model/environment | Continue with desktop candidates | Recommend CLI |
| Process isolation or task queue | Continue desktop | Recommend CLI |

## Recommendation state machine

desktop-native → cli-recommended → user choice

- Decline → desktop-fallback-selected → continue desktop work; suppress another prompt for the task.
- Accept → dependency check only.
  - Missing or signed out → cli-setup-required; guide setup and obtain approval for changes.
  - Ready → cli-awaiting-handoff-approval; create and display a fresh Handoff.

No route decision or recommendation starts a process. Coding, complexity, and duration alone are negative cases.

Stable reason codes:

- explicit-cli-request
- script-or-ci
- scheduled-batch-unattended
- app-close-persistence
- machine-readable-control-plane
- cli-only-model-or-environment
- process-isolation-or-queue
