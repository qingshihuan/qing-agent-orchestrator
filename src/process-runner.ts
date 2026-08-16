import { spawn } from "node:child_process";
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
        try {
          process.kill(pid, "SIGKILL");
          finish(true);
        } catch {
          finish(false);
        }
      });
      killer.once("close", (code) => {
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
  private capturedBytes = 0;
  private spawnError: string | null = null;
  private resolveResult!: (result: ProcessResult) => void;

  constructor(request: ProcessRequest) {
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
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, request.maxOutputBytes - this.capturedBytes);
      if (remaining > 0) {
        const accepted = buffer.subarray(0, remaining);
        destination.push(accepted);
        this.capturedBytes += accepted.length;
        if (accepted.length > 0) notify({ stream, chunk: accepted.toString("utf8") });
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
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  detach(): void {
    this.observers.clear();
  }

  private async cancelInternal(kind: "cancelled" | "timed-out" | "output-limit"): Promise<ProcessResult> {
    if (this.settled) return this.result;
    if (this.cancellationKind === null) this.cancellationKind = kind;
    if (this.pid !== null) await terminateProcessTree(this.pid);
    else this.child?.kill();
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
