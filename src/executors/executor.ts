import type { ProcessExitMetadata, ProcessHandle, ProcessStartMetadata } from "../process-runner.js";
import type { ExecutionResult, Handoff } from "../types.js";

export interface ExecutionContext {
  iteration: number;
  revisionInstructions: string[];
  onProcessStart?: (metadata: ProcessStartMetadata) => void;
  onProcessExit?: (metadata: ProcessExitMetadata) => void;
  onProcessHandle?: (handle: ProcessHandle) => void;
  onSandboxPreflight?: (value: unknown) => void;
  onModelEvent?: (type: string, value: Record<string, unknown>) => void;
}

export interface Executor {
  readonly name: string;
  execute(handoff: Handoff, context: ExecutionContext): Promise<ExecutionResult>;
}
