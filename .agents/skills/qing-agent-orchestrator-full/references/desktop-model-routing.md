# Desktop child model routing

Apply this procedure before every desktop child creation, including Executor and Reviewer children. It governs only the delegated child; never change or restart the current parent to apply a route.

## Candidate source

Inspect the child-creation tool as it is exposed in the current task. Treat only the models and reasoning-effort values that its live schema or tool description currently permits as legal candidates. Do not use a remembered catalog, a static example, CLI configuration, or `relay.user.json` as the desktop candidate source.

If explicit overrides are supported, the child-creation call must include both `model` and `reasoning_effort`. Follow any live compatibility rule on context forking; when full-history forking does not accept overrides, use a permitted bounded history or no history and put all required context in the child prompt. Do not omit an override merely to preserve an incompatible fork mode.

## Selection

Classify the delegated task by role, complexity, and operational risk, then compare the legal candidates using their current tool descriptions:

| Task profile | Model preference | Reasoning effort |
| --- | --- | --- |
| Bounded, routine, low-risk Executor work | Fast or lightweight candidate that fully supports the task | `low` for mechanical work; otherwise `medium` |
| Ordinary implementation or review | Balanced or everyday-work candidate | `medium`; use `high` for multi-file or integration reasoning |
| Complex debugging, architecture, migration, concurrency, or difficult recovery | Strongest suitable coding/reasoning candidate | `high` or `xhigh` |
| High-risk or ambiguity-sensitive Reviewer work | Strongest suitable independent reasoning candidate | `high` or `xhigh`; use a higher live-supported level only when proportionate |

Role changes the emphasis: favor implementation/tool-use ability for an Executor and independent verification/reasoning ability for a Reviewer. Risk may raise the model tier or effort even when the edit is small. Cost or speed may break a tie only after capability and risk are satisfied. Never invent an effort value that the selected candidate does not support.

## Required route record

Before spawning, place a concise route decision in the Handoff or the visible execution record. Record:

- child role and task category;
- complexity and risk classification;
- live candidate source and eligible candidates considered;
- selected `model`, selected `reasoning_effort`, and the task-specific reason;
- context-fork choice when it constrains overrides;
- route status: `explicit` or `inherit-fallback`.

The record must describe the actual arguments used in the child-creation call. A route decision authorizes no filesystem, network, dependency, Git, deployment, messaging, or other operation; those remain governed by the Handoff and safety gates.

## Inheritance fallback

Silent inheritance is prohibited. Use `inherit-fallback` only when the active desktop child backend exposes no usable way to set both model and reasoning effort.

Before creating the child, disclose `inherit-fallback` to the user with the exact missing override capability and the expected impact. Include the same facts in the route record. If the override interface exists but no legal candidate satisfies the task and compatibility constraints, stop before creating any child, disclose the candidate or constraint mismatch, and request user direction; do not inherit or spawn. If a selected candidate is rejected as unavailable, refresh the live candidates and reroute; if no legal candidate remains, stop and request user direction before any child creation. Lack of time, convenience, an omitted argument, or an incompatible full-history fork is not a fallback condition.

## CLI boundary

This procedure does not configure, probe, authenticate, recommend, or invoke the optional CLI backend. CLI routing remains exclusively under [execution-modes.md](execution-modes.md) and [codex-exec.md](codex-exec.md). Do not copy a desktop route into CLI configuration or change the parent model.
