import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateSafetyGate } from "../src/safety-gate.js";
import type { Handoff } from "../src/types.js";
import { validateHandoff } from "../src/validation.js";

async function exampleHandoff(): Promise<Handoff> {
  const result = validateHandoff(JSON.parse(await readFile("examples/game-visual-analyzer/handoff.json", "utf8")));
  assert.ok(result.value, result.errors.join("\n"));
  return result.value;
}

test("scoped example operations are allowed", async () => {
  const report = evaluateSafetyGate(await exampleHandoff());
  assert.equal(report.outcome, "ALLOW");
});

test("broad recursive delete is denied and cannot be approved", async () => {
  const handoff = await exampleHandoff();
  const dangerous: Handoff = {
    ...handoff,
    id: "dangerous-delete",
    workspace: { root: ".", allowedPaths: ["."] },
    requestedOperations: [{ type: "delete", target: ".", reason: "cleanup", risk: "critical" }],
  };
  const first = evaluateSafetyGate(dangerous);
  assert.equal(first.outcome, "DENY");
  const approved = evaluateSafetyGate(dangerous, [first.decisions[0]?.gateId ?? ""]);
  assert.equal(approved.outcome, "DENY");
});

test("remote push requires an operation-scoped approval", async () => {
  const handoff = await exampleHandoff();
  const push: Handoff = {
    ...handoff,
    id: "push-main",
    requestedOperations: [{ type: "git_push", target: "origin/main", reason: "publish", risk: "critical" }],
  };
  const first = evaluateSafetyGate(push);
  assert.equal(first.outcome, "REQUIRE_APPROVAL");
  const id = first.decisions[0]?.gateId;
  assert.ok(id);
  assert.equal(evaluateSafetyGate(push, [id]).outcome, "ALLOW");
});

test("wildcard allowed paths never permit absolute paths or parent traversal", async () => {
  const handoff = await exampleHandoff();
  for (const target of ["C:\\Users\\example\\secret.txt", "../outside.txt"]) {
    const escaped: Handoff = {
      ...handoff,
      id: `escape-${target}`,
      workspace: { ...handoff.workspace, allowedPaths: ["**/*"] },
      requestedOperations: [{ type: "read", target, reason: "escape", risk: "low" }],
    };
    assert.equal(evaluateSafetyGate(escaped).outcome, "DENY");
  }
});
