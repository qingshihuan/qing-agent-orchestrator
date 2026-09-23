# Single-owner architecture — experimental, not a measured optimization claim

The v0.13 controlled retest did not achieve the efficiency target. This change removes the topology/review coupling and adds actual program-controlled single-worker execution instead of only shortening instructions. No uploaded reports, task IDs, local paths, implementations or session traces are published here.

## Implemented boundaries
- Native default is one complete implementation owner. Parallel capability, cross-module scope and CLI transport alone no longer mandate Full/review. Real consequential effects and explicit/pending independent review remain mandatory.
- executionPlan exposes implementationMode, verification and non-granting authority separately. For Full native work the existing parent may implement; only the Reviewer is delegated when whole-task transfer is not justified.
- execute-single uses a concrete Handoff directly. Existing opt-in, effect gate, model-catalog/health, sandbox and workspace checks still apply. No Planner/manager LLM, one worker invocation, no automatic retry/model ladder; worker collaboration tools disabled for that invocation. All waiting and acceptance run in program code.
- Acceptance reuses the existing Relay test evidence and Git audit, plus immutable input SHA-256. Tests do not stand in for source review: the new controller refuses independently reviewed work before starting, rather than inventing a reviewer.
- Same-workspace cooperating runs share an exclusive lease. Cancellation/unknown exit cannot grant ownership to a new process. A lease is not a sandbox, cannot constrain native/legacy tasks, and does not cover overlapping roots or another machine. Crash recovery is manual and fails closed.
- Observed exec turn usage is reported with explicit coverage gaps. A turn is not an API request; no exact bills, aggregate preflight/host usage or spend cap are invented. Native host manager limits are advisory, not enforced by SKILL.md.

## Rollout
Source version 0.14.0-dev.1 and regenerated repository ZIPs are a frozen experimental candidate. The stable v0.13 Release is not replaced. A new stable release requires a separate connected experiment using identical frozen tasks/acceptance and recorded models/efforts/cache conditions. Main CI proves software behavior, not token/time savings.

Compare solo Astra, single-owner Astra (routing tax), whole-task selected model and that same model solo; keep FIRST skill loading as a separate strict-compatibility track. Count all parent/worker/preflight/retry usage and failures; isolate controller costs. The proposed 20% speed/cost improvement and nonincreasing tokens are acceptance targets, not results. No automatic model downshift is justified by unverified unit prices.

Official adapter contracts checked 2026-09-23: https://learn.chatgpt.com/docs/non-interactive-mode and https://learn.chatgpt.com/docs/config-file/config-reference (JSONL turn.completed usage and features.multi_agent). Runtime support is checked by the existing CLI preflight; current-account integration is not established by mocked adapter tests.

The nominated --protect files are integrity checked, not sandbox-mounted read-only. Callers must include the specification and all relevant acceptance inputs/dependencies. Root process exit is not proof that arbitrary background processes do not exist; the lease coordinates this adapter only. The injected Executor interface is trusted test/library code, not an attacker boundary. Cancellation leaves the RunStore terminal record intact.
