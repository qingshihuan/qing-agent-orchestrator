import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import { resolveSafeWorkspace } from "../src/workspace.js";

test("specific project directories outside the Relay runtime are supported", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-runtime-"));
  const external = await mkdtemp(join(tmpdir(), "qing-external-project-"));
  try {
    assert.equal(await resolveSafeWorkspace(runtime, external), external);
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("filesystem and user-profile roots are refused as workspaces", async () => {
  await assert.rejects(resolveSafeWorkspace(process.cwd(), parse(process.cwd()).root), /too broad/i);
  await assert.rejects(resolveSafeWorkspace(process.cwd(), homedir()), /too broad/i);
});

test("protected roots are rejected lexically with case and trailing separators", async () => {
  if (process.platform !== "win32") return;
  await assert.rejects(resolveSafeWorkspace(process.cwd(), homedir().toUpperCase() + "\\"), /too broad/i);
  if (process.env.WINDIR) await assert.rejects(resolveSafeWorkspace(process.cwd(), process.env.WINDIR + "\\"), /too broad/i);
  if (process.env.ProgramFiles) await assert.rejects(resolveSafeWorkspace(process.cwd(), process.env.ProgramFiles.toLowerCase() + "\\"), /too broad/i);
});
