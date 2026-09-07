# Runtime reliability and coordination overhead

This focused maintenance change is based on `a4c3b80492fd0a514a8191a61b8118cef3b0edda` (v0.8.0). It does not change model candidates, the parent model, Direct/Lite/Full budgets, effect approvals, sandbox permissions, network allowlists, or the default disabled real-execution setting. It does not publish a new release.

## Changes

- Concurrent first health checks await one persistent-cache read before considering a probe. Equivalent candidate aliases share the same fingerprint/probe but retain the requesting candidate ID in returned audit records.
- Health status matches the current model, reasoning level, profile, backend and roles rather than just a reusable candidate ID. Disabled or changed candidates are not presented as previously verified.
- Per-checker cache writes are serialized and use unique same-directory temporary files. Cache persistence failure preserves the actual probe result and in-memory reuse. Independent processes remain best-effort last-writer-wins caches, not a transactional evidence database.
- Malformed persisted records are ignored. Rejected version/catalog discovery promises can recover on a later explicit check (after the existing negative TTL where applicable); there is no internal retry loop. Cancelled/truncated discovery is not healthy evidence.
- Live process output uses independent incremental UTF-8 decoders for stdout and stderr. A split Chinese character or emoji is reconstructed before notifying observers; an incomplete final character is flushed consistently with the final captured result.
- Repeated cancellation shares one process-tree termination sequence. Retained completed handles release raw output buffers and observer closures. Truncated output chunks do not retain an oversized original backing allocation.
- Invalid timeout/output limits are rejected before process creation. Output accounting remains byte-based; zero output budget still permits silent commands.

## Regression coverage and evidence boundaries

Seven process-runner tests and nine model-health-cache tests were added to the existing test files, so the existing explicit npm test command includes them. Coverage includes deterministic UTF-8 transport fragments, output retention, repeated cancellation, invalid limits, concurrent cache startup, identity/fingerprint changes, cache write failures, concurrent snapshots, discovery recovery and cancelled/malformed health evidence.

The focused process tests use real Node child processes plus explicitly injected transport fragments. Health-cache tests use a fake ProcessRunner; they do not demonstrate a real account's Codex entitlement or end-to-end model execution. No token-savings percentage or overall speedup is claimed from these unit tests.

The repository's existing CI matrix (Windows/Linux, Node 18/22) and archive/runtime consistency checks remain the acceptance gates. Both packaged editions must be regenerated with `scripts/package-skill-editions.ps1 -Validate`; a source-only change is insufficient because the full skill ships a precompiled runtime. The standard edition has no runtime and is not changed by these runtime fixes.
