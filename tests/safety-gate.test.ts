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

test("only reviewed exact documentation hosts are auto-allowed for network_read", async () => {
  const handoff = await exampleHandoff();
  const withOperation = (type: "network_read" | "network_access", target: string): Handoff => ({
    ...handoff,
    id: `network-${type}-${target.length}`,
    requestedOperations: [{ type, target, reason: "read documentation", risk: "low" }],
  });
  for (const target of [
    "https://developers.openai.com/api/docs/guides/latest-model",
    "https://docs.github.com/en/actions",
    "https://learn.chatgpt.com/docs/codex/cli",
  ]) {
    assert.equal(evaluateSafetyGate(withOperation("network_read", target)).outcome, "ALLOW", target);
  }
  for (const target of [
    "https://example.com/docs",
    "https://developers.openai.com.evil.example/docs",
    "https://developers.openai.com:8443/docs",
    "https://user:password@developers.openai.com/docs",
    "https://developers.openai.com/docs#access_token=secret",
    "https://developers.openai.com/docs?redirect=https://127.0.0.1",
    "private documentation",
  ]) {
    assert.equal(evaluateSafetyGate(withOperation("network_read", target)).outcome, "REQUIRE_APPROVAL", target);
  }
  assert.equal(evaluateSafetyGate(withOperation("network_access", "https://api.example.com/private")).outcome, "REQUIRE_APPROVAL");
});

test("network_read fails closed for credential query names and local, private, reserved, or special addresses", async () => {
  const handoff = await exampleHandoff();
  const withTarget = (target: string): Handoff => ({
    ...handoff,
    id: `network-negative-${target.length}`,
    requestedOperations: [{ type: "network_read", target, reason: "negative boundary fixture", risk: "low" }],
  });
  const sensitiveNames = ["token", "authorization", "key", "api_key", "access_token", "signature", "secret", "password", "session", "cookie"];
  for (const name of sensitiveNames) {
    const target = `https://developers.openai.com/docs?${name}=fixture`;
    assert.equal(evaluateSafetyGate(withTarget(target)).outcome, "REQUIRE_APPROVAL", target);
  }
  for (const target of [
    "https://localhost/docs",
    "https://service.local/docs",
    "https://service.internal/docs",
    "https://intranet/docs",
    "https://0.0.0.1/docs",
    "https://10.0.0.1/docs",
    "https://100.64.0.1/docs",
    "https://127.0.0.1/docs",
    "https://169.254.1.1/docs",
    "https://172.16.0.1/docs",
    "https://192.168.1.1/docs",
    "https://192.0.0.1/docs",
    "https://192.0.2.1/docs",
    "https://198.18.0.1/docs",
    "https://198.51.100.1/docs",
    "https://203.0.113.1/docs",
    "https://224.0.0.1/docs",
    "https://240.0.0.1/docs",
    "https://255.255.255.255/docs",
    "https://[::1]/docs",
    "https://[fe80::1]/docs",
    "https://[fc00::1]/docs",
    "https://[fd00::1]/docs",
    "https://[::ffff:127.0.0.1]/docs",
    "https://[::ffff:192.168.1.1]/docs",
    "https://[2001:db8::1]/docs",
  ]) {
    assert.equal(evaluateSafetyGate(withTarget(target)).outcome, "REQUIRE_APPROVAL", target);
  }
});

test("global writes, purchases, and material scope expansion remain effect-gated", async () => {
  const handoff = await exampleHandoff();
  for (const type of ["global_write", "purchase", "scope_expansion"] as const) {
    const report = evaluateSafetyGate({ ...handoff, id: `effect-${type}`, requestedOperations: [{ type, target: "declared target", reason: "consequential effect", risk: "medium" }] });
    assert.equal(report.outcome, "REQUIRE_APPROVAL", type);
  }
});
