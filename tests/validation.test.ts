import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateAcceptanceEvidence, validateHandoff, validateRelayCriterionEvidence } from "../src/validation.js";

async function readExample(): Promise<unknown> {
  return JSON.parse(await readFile("examples/game-visual-analyzer/handoff.json", "utf8"));
}

async function listRelativeFiles(root: string, directory = ""): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, relative));
    else if (entry.isFile()) files.push(relative.replaceAll("\\", "/"));
  }
  return files.sort();
}

test("example Handoff is valid", async () => {
  const result = validateHandoff(await readExample());
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.value?.id, "game-visual-analyzer-001");
});

test("standard edition is standalone and bundles every declared schema contract", async () => {
  const standardRoot = ".agents/skills/qing-agent-orchestrator";
  assert.deepEqual(await listRelativeFiles(standardRoot), [
    "SKILL.md",
    "agents/openai.yaml",
    "references/handoff-protocol.md",
    "references/orchestrator-spec.md",
    "references/reviewer-rules.md",
    "references/safety-gates.md",
    "schemas/handoff.schema.json",
    "schemas/review.schema.json",
  ]);

  const standardHandoffText = await readFile(join(standardRoot, "schemas/handoff.schema.json"), "utf8");
  const standardReviewText = await readFile(join(standardRoot, "schemas/review.schema.json"), "utf8");
  const standardHandoff = JSON.parse(standardHandoffText) as any;
  const standardReview = JSON.parse(standardReviewText) as any;
  assert.equal(standardHandoff.$id, "https://qing.local/schemas/desktop/handoff.schema.json");
  assert.equal(standardReview.$id, "https://qing.local/schemas/desktop/review.schema.json");
  assert.deepEqual(standardHandoff.properties.acceptanceCriteria.items.properties.verificationOwner.enum, ["parent", "internal-child", "hybrid"]);
  assert.doesNotMatch(standardHandoffText, /relayVerification|process\.started|process\.exited|process\.heartbeat|sandbox\.preflight|"pid"|"exitCode"|"elapsedMs"|"effectiveSandbox"/i);

  const markdown = await Promise.all((await listRelativeFiles(standardRoot))
    .filter((path) => path.endsWith(".md"))
    .map((path) => readFile(join(standardRoot, path), "utf8")));
  const schemaReferences = [...new Set(markdown.flatMap((text) => text.match(/schemas\/[A-Za-z0-9._-]+\.json/g) ?? []))].sort();
  assert.deepEqual(schemaReferences, ["schemas/handoff.schema.json", "schemas/review.schema.json"]);
  for (const reference of schemaReferences) await readFile(join(standardRoot, reference), "utf8");
  const skillText = await readFile(join(standardRoot, "SKILL.md"), "utf8");
  for (const reference of schemaReferences) assert.match(skillText, new RegExp(reference.replaceAll(".", "\\.")));

  const allText = (await Promise.all((await listRelativeFiles(standardRoot)).map((path) => readFile(join(standardRoot, path), "utf8")))).join("\n");
  assert.doesNotMatch(allText, /codex\s+exec|Codex CLI|QING_RELAY_HOME|qing\.ps1/i);
});

test("desktop Review schema fail-closes PASS and bounded revision contracts", async () => {
  const schema = JSON.parse(await readFile(".agents/skills/qing-agent-orchestrator/schemas/review.schema.json", "utf8")) as any;
  assert.equal(schema.properties.iteration.minimum, 1);
  assert.equal(schema.properties.iteration.maximum, 5);
  for (const field of ["executorStatus", "deliverables", "pendingOperations"]) assert.ok(schema.required.includes(field), field);
  const passRule = schema.allOf.find((rule: any) => rule.if?.properties?.verdict?.const === "PASS")?.then?.properties;
  assert.ok(passRule);
  assert.equal(passRule.executorStatus.const, "succeeded");
  assert.equal(passRule.criteria.items.properties.status.const, "pass");
  assert.equal(passRule.criterionAudit.items.properties.status.const, "pass");
  assert.deepEqual(passRule.findings.items.properties.severity.enum, ["minor", "info"]);
  assert.equal(passRule.tests.items.properties.status.const, "passed");
  assert.equal(passRule.deliverables.items.properties.status.const, "present");
  assert.equal(passRule.pendingOperations.maxItems, 0);
  assert.equal(passRule.revisionInstructions.maxItems, 0);
  const reviseRule = schema.allOf.find((rule: any) => rule.if?.properties?.verdict?.const === "REVISE")?.then?.properties;
  assert.equal(reviseRule.revisionInstructions.minItems, 1);
});

test("Handoff rejects an empty acceptance criteria list", async () => {
  const value = (await readExample()) as Record<string, unknown>;
  value.acceptanceCriteria = [];
  const result = validateHandoff(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /acceptanceCriteria/);
});

test("Handoff requires legal owners and unique criterion IDs", async () => {
  const base = (await readExample()) as any;
  for (const owner of ["relay", "hybrid"]) {
    base.acceptanceCriteria[0].verificationOwner = owner;
    base.acceptanceCriteria[0].relayVerification = { kind: "event-count", eventType: "process.started", operator: "gte", expected: 1 };
    assert.equal(validateHandoff(base).ok, true);
  }
  base.acceptanceCriteria[0].verificationOwner = "executor";
  delete base.acceptanceCriteria[0].relayVerification;
  assert.equal(validateHandoff(base).ok, true);
  delete base.acceptanceCriteria[0].verificationOwner;
  assert.equal(validateHandoff(base).ok, false);
  base.acceptanceCriteria[0].verificationOwner = "someone";
  assert.equal(validateHandoff(base).ok, false);
  base.acceptanceCriteria[0].verificationOwner = "executor";
  base.acceptanceCriteria.push({ ...base.acceptanceCriteria[0] });
  assert.match(validateHandoff(base).errors.join("\n"), /duplicate/);
});

test("relayVerification is a strict closed owner-bound discriminated union", async () => {
  const base = (await readExample()) as any;
  const criterion = base.acceptanceCriteria[0];
  criterion.verificationOwner = "relay";
  const valid = [
    { kind: "event-count", eventType: "process.exited", operator: "eq", expected: 1 },
    { kind: "event-payload", eventType: "process.exited", field: "exitCode", operator: "eq", expected: 0 },
  ];
  for (const relayVerification of valid) assert.equal(validateHandoff({ ...base, acceptanceCriteria: [{ ...criterion, relayVerification }] }).ok, true);
  const invalid = [
    undefined,
    { ...valid[0], extra: true },
    { ...valid[0], eventType: "run.created" },
    { ...valid[1], field: "command" },
    { ...valid[1], operator: "contains" },
    { ...valid[1], expected: "0" },
    { ...valid[0], expected: Number.POSITIVE_INFINITY },
    { ...valid[0], expected: 1_000_001 },
  ];
  for (const relayVerification of invalid) assert.equal(validateHandoff({ ...base, acceptanceCriteria: [{ ...criterion, relayVerification }] }).ok, false);
  assert.equal(validateHandoff({ ...base, acceptanceCriteria: [{ ...criterion, verificationOwner: "executor", relayVerification: valid[0] }] }).ok, false);
});

test("Relay criterion evidence is strict and UI acceptance evidence remains separate", () => {
  const valid = { version: "1.0", evidenceId: "ev-1", source: "relay", runId: "run-1", handoffId: "h-1", criterionId: "ac-1", iteration: 1, result: "pass", evidence: "Observed exact expected output.", recordedAt: "2026-08-15T01:02:03.000Z" };
  assert.equal(validateRelayCriterionEvidence(valid).ok, true);
  for (const mutation of [
    { evidence: "" }, { source: "executor" }, { result: "maybe" }, { iteration: 0 }, { recordedAt: "yesterday" }, { extra: true }, { evidenceId: undefined },
  ]) assert.equal(validateRelayCriterionEvidence({ ...valid, ...mutation }).ok, false);
  const ui = { version: "1.0", id: "ui-1", title: "UI", seededSetup: [{ id: "s", action: "fixture", target: "db" }], actions: [{ id: "a", action: "click", target: "button" }], assertions: [{ id: "x", description: "Shown", target: "screen", expected: "yes" }], observedEvidence: [{ assertionId: "x", observed: "yes", passed: true, evidence: "screenshot" }], result: "passed" };
  assert.equal(validateAcceptanceEvidence(ui).ok, true);
});
