import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
export async function terminateProcessTree(pid, platform = process.platform) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
        return false;
    if (platform === "win32") {
        return new Promise((resolve) => {
            const taskkill = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\taskkill.exe`;
            const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
                windowsHide: true,
                stdio: ["ignore", "ignore", "ignore"],
            });
            let settled = false;
            const finish = (value) => {
                if (settled)
                    return;
                settled = true;
                resolve(value);
            };
            killer.once("error", () => {
                if (settled)
                    return;
                try {
                    process.kill(pid, "SIGKILL");
                    finish(true);
                }
                catch {
                    finish(false);
                }
            });
            killer.once("close", (code) => {
                if (settled)
                    return;
                if (code === 0) {
                    finish(true);
                    return;
                }
                try {
                    process.kill(pid, "SIGKILL");
                    finish(true);
                }
                catch {
                    finish(false);
                }
            });
        });
    }
    let attempted = false;
    try {
        process.kill(-pid, "SIGTERM");
        attempted = true;
    }
    catch {
        try {
            process.kill(pid, "SIGTERM");
            attempted = true;
        }
        catch {
            return false;
        }
    }
    await wait(75);
    try {
        process.kill(-pid, "SIGKILL");
    }
    catch {
        try {
            process.kill(pid, "SIGKILL");
        }
        catch {
            // The process may have exited after SIGTERM.
        }
    }
    return attempted;
}
class NodeProcessHandle {
    pid;
    result;
    observers = new Set();
    child;
    settled = false;
    timedOut = false;
    outputLimitExceeded = false;
    cancellationKind = null;
    stdoutChunks = [];
    stderrChunks = [];
    stdoutDecoder = new StringDecoder("utf8");
    stderrDecoder = new StringDecoder("utf8");
    terminationPromise = null;
    capturedBytes = 0;
    spawnError = null;
    resolveResult;
    constructor(request) {
        // Node clamps invalid/overflowing delays to 1 ms. Reject them before spawn.
        if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 2_147_483_647) {
            throw new RangeError("timeoutMs must be an integer between 1 and 2147483647.");
        }
        if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 0) {
            throw new RangeError("maxOutputBytes must be a non-negative safe integer.");
        }
        let spawned;
        try {
            spawned = spawn(request.command, request.args, {
                cwd: request.cwd,
                shell: false,
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["pipe", "pipe", "pipe"],
                ...(request.environment ? { env: request.environment } : {}),
            });
        }
        catch (error) {
            this.settled = true;
            this.child = null;
            this.pid = null;
            this.spawnError = error instanceof Error ? error.message : String(error);
            this.result = Promise.resolve({
                exitCode: null,
                signal: null,
                stdout: "",
                stderr: "",
                timedOut: false,
                outputLimitExceeded: false,
                spawnError: this.spawnError,
                cancelled: false,
            });
            return;
        }
        this.child = spawned;
        this.pid = spawned.pid ?? null;
        this.result = new Promise((resolve) => {
            this.resolveResult = resolve;
        });
        const startedAt = new Date().toISOString();
        if (this.pid !== null) {
            try {
                request.onStart?.({
                    pid: this.pid,
                    command: request.command,
                    args: [...request.args],
                    cwd: request.cwd,
                    startedAt,
                });
            }
            catch {
                // Observability callbacks must never affect the owned process.
            }
        }
        try {
            request.onHandle?.(this);
        }
        catch {
            // Observability callbacks must never affect the owned process.
        }
        const notify = (event) => {
            for (const observer of [...this.observers]) {
                try {
                    observer(event);
                }
                catch {
                    // A disconnected or failing observer cannot cancel the process.
                }
            }
        };
        const append = (chunk, destination, stream) => {
            if (this.settled)
                return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = Math.max(0, request.maxOutputBytes - this.capturedBytes);
            if (remaining > 0) {
                // Copy only a truncated chunk: a small view would retain the entire
                // incoming allocation even though most of it exceeds the output cap.
                const accepted = buffer.length > remaining ? Buffer.from(buffer.subarray(0, remaining)) : buffer;
                destination.push(accepted);
                this.capturedBytes += accepted.length;
                const decoder = stream === "stdout" ? this.stdoutDecoder : this.stderrDecoder;
                const text = decoder.write(accepted);
                if (text.length > 0)
                    notify({ stream, chunk: text });
            }
            if (buffer.length > remaining && !this.outputLimitExceeded) {
                this.outputLimitExceeded = true;
                void this.cancelInternal("output-limit");
            }
        };
        spawned.stdout.on("data", (chunk) => append(chunk, this.stdoutChunks, "stdout"));
        spawned.stderr.on("data", (chunk) => append(chunk, this.stderrChunks, "stderr"));
        const timeout = setTimeout(() => {
            if (this.settled)
                return;
            this.timedOut = true;
            void this.cancelInternal("timed-out");
        }, request.timeoutMs);
        const finish = (exitCode, signal) => {
            if (this.settled)
                return;
            this.settled = true;
            clearTimeout(timeout);
            // Flush an incomplete final code point once, just as Buffer.toString
            // does for the final captured result. Each stream has its own decoder.
            const stdoutTail = this.stdoutDecoder.end();
            const stderrTail = this.stderrDecoder.end();
            if (stdoutTail)
                notify({ stream: "stdout", chunk: stdoutTail });
            if (stderrTail)
                notify({ stream: "stderr", chunk: stderrTail });
            const endedAt = new Date().toISOString();
            const cancelled = this.cancellationKind === "cancelled";
            const result = {
                exitCode,
                signal,
                stdout: Buffer.concat(this.stdoutChunks).toString("utf8"),
                stderr: Buffer.concat(this.stderrChunks).toString("utf8"),
                timedOut: this.timedOut,
                outputLimitExceeded: this.outputLimitExceeded,
                spawnError: this.spawnError,
                cancelled,
            };
            try {
                request.onExit?.({
                    pid: this.pid,
                    exitCode,
                    signal,
                    endedAt,
                    cancelled,
                    timedOut: this.timedOut,
                    outputLimitExceeded: this.outputLimitExceeded,
                });
            }
            catch {
                // Observability callbacks must never affect the result.
            }
            // A retained handle should not retain both raw buffers and result text,
            // nor closures belonging to observers that can no longer receive data.
            this.stdoutChunks.length = 0;
            this.stderrChunks.length = 0;
            this.observers.clear();
            this.resolveResult(result);
        };
        spawned.once("error", (error) => {
            this.spawnError = error.message;
            finish(null, null);
        });
        spawned.once("close", (exitCode, signal) => finish(exitCode, signal));
        spawned.stdin.on("error", () => undefined);
        spawned.stdin.end(request.stdin);
    }
    observe(observer) {
        if (this.settled)
            return () => undefined;
        this.observers.add(observer);
        return () => {
            this.observers.delete(observer);
        };
    }
    detach() {
        this.observers.clear();
    }
    async cancelInternal(kind) {
        if (!this.settled && this.terminationPromise === null) {
            this.cancellationKind = kind;
            this.terminationPromise = this.pid !== null
                ? terminateProcessTree(this.pid)
                : Promise.resolve(this.child?.kill() ?? false);
        }
        // Cancel/timeout/output-limit may race. All callers share one tree-kill
        // sequence and await its escalation even if the direct child exits first.
        if (this.terminationPromise)
            await this.terminationPromise;
        return this.result;
    }
    cancel() {
        return this.cancelInternal("cancelled");
    }
}
export class NodeProcessRunner {
    start(request) {
        return new NodeProcessHandle(request);
    }
    run(request) {
        return this.start(request).result;
    }
}
