import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProcessStartMetadata {
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
}

export interface ProcessExitMetadata {
  pid: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  endedAt: string;
  cancelled: boolean;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

export interface ProcessOutputEvent {
  stream: "stdout" | "stderr";
  chunk: string;
}

export type ProcessObserver = (event: ProcessOutputEvent) => void;

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
  environment?: NodeJS.ProcessEnv;
  onStart?: (metadata: ProcessStartMetadata) => void;
  onExit?: (metadata: ProcessExitMetadata) => void;
  onHandle?: (handle: ProcessHandle) => void;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  spawnError: string | null;
  cancelled?: boolean;
}

export interface ProcessHandle {
  readonly pid: number | null;
  readonly result: Promise<ProcessResult>;
  observe(observer: ProcessObserver): () => void;
  detach(): void;
  cancel(): Promise<ProcessResult>;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
  start?(request: ProcessRequest): ProcessHandle;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function terminateProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;

  if (platform === "win32") {
    return new Promise((resolve) => {
      const taskkill = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\taskkill.exe`;
      const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      killer.once("error", () => {
        if (settled) return;
        try {
          process.kill(pid, "SIGKILL");
          finish(true);
        } catch {
          finish(false);
        }
      });
      killer.once("close", (code) => {
        if (settled) return;
        if (code === 0) { finish(true); return; }
        try { process.kill(pid, "SIGKILL"); finish(true); } catch { finish(false); }
      });
    });
  }

  let attempted = false;
  try {
    process.kill(-pid, "SIGTERM");
    attempted = true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      attempted = true;
    } catch {
      return false;
    }
  }
  await wait(75);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited after SIGTERM.
    }
  }
  return attempted;
}

class NodeProcessHandle implements ProcessHandle {
  readonly pid: number | null;
  readonly result: Promise<ProcessResult>;
  private readonly observers = new Set<ProcessObserver>();
  private readonly child: ChildProcessWithoutNullStreams | null;
  private settled = false;
  private timedOut = false;
  private outputLimitExceeded = false;
  private cancellationKind: "cancelled" | "timed-out" | "output-limit" | null = null;
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private terminationPromise: Promise<boolean> | null = null;
  private capturedBytes = 0;
  private spawnError: string | null = null;
  private resolveResult!: (result: ProcessResult) => void;

  constructor(request: ProcessRequest) {
    // Node clamps invalid/overflowing delays to 1 ms. Reject them before spawn.
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 2_147_483_647) {
      throw new RangeError("timeoutMs must be an integer between 1 and 2147483647.");
    }
    if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 0) {
      throw new RangeError("maxOutputBytes must be a non-negative safe integer.");
    }
    let spawned: ChildProcessWithoutNullStreams;
    try {
      spawned = spawn(request.command, request.args, {
        cwd: request.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        ...(request.environment ? { env: request.environment } : {}),
      });
    } catch (error) {
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
    this.result = new Promise<ProcessResult>((resolve) => {
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
      } catch {
        // Observability callbacks must never affect the owned process.
      }
    }
    try {
      request.onHandle?.(this);
    } catch {
      // Observability callbacks must never affect the owned process.
    }

    const notify = (event: ProcessOutputEvent): void => {
      for (const observer of [...this.observers]) {
        try {
          observer(event);
        } catch {
          // A disconnected or failing observer cannot cancel the process.
        }
      }
    };

    const append = (chunk: Buffer | string, destination: Buffer[], stream: "stdout" | "stderr"): void => {
      if (this.settled) return;
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
        if (text.length > 0) notify({ stream, chunk: text });
      }
      if (buffer.length > remaining && !this.outputLimitExceeded) {
        this.outputLimitExceeded = true;
        void this.cancelInternal("output-limit");
      }
    };

    spawned.stdout.on("data", (chunk: Buffer | string) => append(chunk, this.stdoutChunks, "stdout"));
    spawned.stderr.on("data", (chunk: Buffer | string) => append(chunk, this.stderrChunks, "stderr"));

    const timeout = setTimeout(() => {
      if (this.settled) return;
      this.timedOut = true;
      void this.cancelInternal("timed-out");
    }, request.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (this.settled) return;
      this.settled = true;
      clearTimeout(timeout);
      // Flush an incomplete final code point once, just as Buffer.toString
      // does for the final captured result. Each stream has its own decoder.
      const stdoutTail = this.stdoutDecoder.end();
      const stderrTail = this.stderrDecoder.end();
      if (stdoutTail) notify({ stream: "stdout", chunk: stdoutTail });
      if (stderrTail) notify({ stream: "stderr", chunk: stderrTail });
      const endedAt = new Date().toISOString();
      const cancelled = this.cancellationKind === "cancelled";
      const result: ProcessResult = {
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
      } catch {
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

  observe(observer: ProcessObserver): () => void {
    if (this.settled) return () => undefined;
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  detach(): void {
    this.observers.clear();
  }

  private async cancelInternal(kind: "cancelled" | "timed-out" | "output-limit"): Promise<ProcessResult> {
    if (!this.settled && this.terminationPromise === null) {
      this.cancellationKind = kind;
      this.terminationPromise = this.pid !== null
        ? terminateProcessTree(this.pid)
        : Promise.resolve(this.child?.kill() ?? false);
    }
    // Cancel/timeout/output-limit may race. All callers share one tree-kill
    // sequence and await its escalation even if the direct child exits first.
    if (this.terminationPromise) await this.terminationPromise;
    return this.result;
  }

  cancel(): Promise<ProcessResult> {
    return this.cancelInternal("cancelled");
  }
}

export class NodeProcessRunner implements ProcessRunner {
  start(request: ProcessRequest): ProcessHandle {
    return new NodeProcessHandle(request);
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    return this.start(request).result;
  }
}
