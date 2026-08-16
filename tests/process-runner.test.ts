import assert from "node:assert/strict";
import test from "node:test";
import { NodeProcessRunner } from "../src/process-runner.js";

const runner = new NodeProcessRunner();

test("process runner captures stdout without a shell", async () => {
  const result = await runner.run({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 5_000,
    maxOutputBytes: 65_536,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.spawnError, null);
});

test("process runner terminates a timed-out process", async () => {
  const result = await runner.run({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 5000)"],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 100,
    maxOutputBytes: 65_536,
  });
  assert.equal(result.timedOut, true);
});

test("process runner enforces the combined output limit", async () => {
  const result = await runner.run({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(100000))"],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 5_000,
    maxOutputBytes: 1_024,
  });
  assert.equal(result.outputLimitExceeded, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 1_024);
});

test("live handle observes output, detach preserves completion, and cancel terminates", async () => {
  const observed: string[] = [];
  const natural = runner.start({ command: process.execPath, args: ["-e", "console.log('first');setTimeout(()=>console.log('last'),80)"], cwd: process.cwd(), stdin: "", timeoutMs: 2_000, maxOutputBytes: 65_536 });
  const detach = natural.observe(({ chunk }) => observed.push(chunk));
  for (let attempt = 0; attempt < 20 && observed.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10)); detach();
  const completed = await natural.result;
  assert.equal(completed.exitCode, 0); assert.match(observed.join(""), /first/); assert.match(completed.stdout, /last/);
  const cancelled = runner.start({ command: process.execPath, args: ["-e", "setTimeout(()=>{},5000)"], cwd: process.cwd(), stdin: "", timeoutMs: 10_000, maxOutputBytes: 65_536 });
  const result = await cancelled.cancel(); assert.equal(result.cancelled, true);
});

test("cancel terminates a real descendant process tree", async () => {
  let descendantPid: number | null = null;
  const script = "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},30000)";
  const handle = runner.start({ command: process.execPath, args: ["-e", script], cwd: process.cwd(), stdin: "", timeoutMs: 35_000, maxOutputBytes: 65_536 });
  const detach = handle.observe(({ chunk }) => { const value = Number.parseInt(chunk.trim(), 10); if (Number.isInteger(value)) descendantPid = value; });
  for (let attempt = 0; attempt < 200 && descendantPid === null; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(descendantPid !== null && descendantPid > 0);
  const result = await handle.cancel();
  detach();
  assert.equal(result.cancelled, true);
  assert.throws(() => process.kill(descendantPid!, 0));
});
