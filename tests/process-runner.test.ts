import assert from "node:assert/strict";
import test from "node:test";
import { NodeProcessRunner, type ProcessHandle, type ProcessRequest } from "../src/process-runner.js";

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

const quietRequest = (): ProcessRequest => ({
  command: process.execPath, args: ["-e", "setTimeout(()=>{},30000)"],
  cwd: process.cwd(), stdin: "", timeoutMs: 5_000, maxOutputBytes: 65_536,
});

// Inject transport fragments deterministically: OS pipe coalescing must not
// decide whether a split-code-point regression test actually covers a split.
function internals(handle: ProcessHandle) {
  return handle as unknown as {
    child: { stdout: { emit(event: string, chunk: Buffer): void }; stderr: { emit(event: string, chunk: Buffer): void } };
    stdoutChunks: Buffer[]; stderrChunks: Buffer[]; observers: Set<unknown>;
  };
}

test("observers preserve split UTF-8 independently for stdout and stderr", async () => {
  const handle = runner.start(quietRequest());
  const observed = { stdout: "", stderr: "" };
  handle.observe(({ stream, chunk }) => { observed[stream] += chunk; });
  try {
    const streams = internals(handle).child;
    const stdout = Buffer.from("青😀\n");
    const stderr = Buffer.from("错误🌊\n");
    for (let index = 0; index < Math.max(stdout.length, stderr.length); index += 1) {
      if (index < stdout.length) streams.stdout.emit("data", stdout.subarray(index, index + 1));
      if (index < stderr.length) streams.stderr.emit("data", stderr.subarray(index, index + 1));
    }
    assert.deepEqual(observed, { stdout: "青😀\n", stderr: "错误🌊\n" });
  } finally {
    const result = await handle.cancel();
    assert.equal(observed.stdout, result.stdout);
    assert.equal(observed.stderr, result.stderr);
  }
});

test("incomplete final UTF-8 is flushed exactly once on completion", async () => {
  const handle = runner.start(quietRequest());
  let observed = "";
  handle.observe(({ chunk }) => { observed += chunk; });
  try {
    internals(handle).child.stdout.emit("data", Buffer.from([0xe9, 0x9d]));
    const result = await handle.cancel();
    assert.equal(observed, "\ufffd");
    assert.equal(observed, result.stdout);
    await handle.cancel();
    assert.equal(observed, "\ufffd");
  } finally { await handle.cancel(); }
});

test("output-limit truncation does not retain an oversized backing buffer", async () => {
  const handle = runner.start({ ...quietRequest(), maxOutputBytes: 1 });
  const incoming = Buffer.alloc(1024 * 1024, 120);
  try {
    const state = internals(handle);
    state.child.stdout.emit("data", incoming);
    assert.equal(state.stdoutChunks[0]!.length, 1);
    assert.notEqual(state.stdoutChunks[0]!.buffer, incoming.buffer);
    const result = await handle.result;
    assert.equal(result.stdout, "x");
    assert.equal(result.outputLimitExceeded, true);
  } finally { await handle.cancel(); }
});

test("completed handles release captured buffers and observer closures", async () => {
  const handle = runner.start(quietRequest());
  handle.observe(() => undefined);
  try {
    const state = internals(handle);
    state.child.stdout.emit("data", Buffer.from("captured"));
    state.child.stderr.emit("data", Buffer.from("diagnostic"));
    const result = await handle.cancel();
    assert.equal(result.stdout, "captured");
    assert.equal(result.stderr, "diagnostic");
    assert.equal(state.stdoutChunks.length, 0);
    assert.equal(state.stderrChunks.length, 0);
    assert.equal(state.observers.size, 0);
    handle.observe(() => undefined)();
    assert.equal(state.observers.size, 0);
  } finally { await handle.cancel(); }
});

test("concurrent cancellation shares one termination sequence", async () => {
  const handle = runner.start(quietRequest());
  const originalKill = process.kill;
  let terminations = 0;
  // The POSIX path sends SIGTERM directly; Windows uses taskkill instead.
  if (process.platform !== "win32") {
    process.kill = ((pid: number, signal?: string | number) => {
      if (pid === -handle.pid! && signal === "SIGTERM") terminations += 1;
      return originalKill.call(process, pid, signal);
    }) as typeof process.kill;
  }
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => handle.cancel()));
    assert.ok(results.every((result) => result.cancelled));
    assert.ok(results.every((result) => result === results[0]));
    if (process.platform !== "win32") assert.equal(terminations, 1);
  } finally {
    process.kill = originalKill;
    await handle.cancel();
  }
});

test("invalid timeout and output budgets are rejected before spawning", () => {
  let spawned = false;
  const request = { ...quietRequest(), onStart: () => { spawned = true; } };
  for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 2_147_483_648]) {
    assert.throws(() => runner.start({ ...request, timeoutMs }), /timeoutMs/);
  }
  for (const maxOutputBytes of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => runner.start({ ...request, maxOutputBytes }), /maxOutputBytes/);
  }
  assert.equal(spawned, false);
});

test("zero output budget accepts a silent successful process", async () => {
  const result = await runner.run({ ...quietRequest(), args: ["-e", ""], maxOutputBytes: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.outputLimitExceeded, false);
});
