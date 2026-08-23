import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexModelCatalog, validateCandidateAgainstCatalog } from "../src/codex-model-catalog.js";

const catalogJson = JSON.stringify({
  models: [
    {
      slug: "gpt-5.6-sol",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" },
        { effort: "xhigh" },
        { effort: "max" },
        { effort: "ultra" },
      ],
      minimal_client_version: "0.144.0",
    },
  ],
});

test("bundled catalog parser retains exact model, effort, and minimum-version capabilities", () => {
  const catalog = parseCodexModelCatalog(catalogJson);
  assert.deepEqual(catalog.models.get("gpt-5.6-sol"), {
    slug: "gpt-5.6-sol",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    minimalClientVersion: "0.144.0",
  });
});

test("catalog validation accepts an advertised pair and rejects absent models, efforts, and old clients", () => {
  const catalog = parseCodexModelCatalog(catalogJson);
  const candidate = { backend: "codex-cli" as const, model: "gpt-5.6-sol", reasoningEffort: "ultra" as const };
  assert.equal(validateCandidateAgainstCatalog(candidate, catalog, "codex-cli 0.144.0"), null);
  assert.match(validateCandidateAgainstCatalog({ ...candidate, model: "not-real" }, catalog, "codex-cli 0.144.0") ?? "", /absent/);
  assert.match(validateCandidateAgainstCatalog({ ...candidate, reasoningEffort: "minimal" }, catalog, "codex-cli 0.144.0") ?? "", /unsupported/);
  assert.match(validateCandidateAgainstCatalog(candidate, catalog, "codex-cli 0.143.9") ?? "", /requires Codex CLI 0\.144\.0/);
  assert.match(validateCandidateAgainstCatalog(candidate, catalog, "unknown") ?? "", /Could not parse/);
});

test("catalog parser fails closed for malformed, empty, duplicate, or unknown-effort data", () => {
  assert.throws(() => parseCodexModelCatalog("not-json"), /valid JSON/);
  assert.throws(() => parseCodexModelCatalog("{}"), /models array/);
  assert.throws(() => parseCodexModelCatalog('{"models":[]}'), /empty/);
  assert.throws(() => parseCodexModelCatalog(JSON.stringify({ models: [
    { slug: "same", supported_reasoning_levels: [{ effort: "high" }] },
    { slug: "same", supported_reasoning_levels: [{ effort: "high" }] },
  ] })), /duplicate/);
  assert.throws(() => parseCodexModelCatalog(JSON.stringify({ models: [
    { slug: "model", supported_reasoning_levels: [{ effort: "impossible" }] },
  ] })), /invalid effort/);
});
