import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import type { Handoff, OperationRequest } from "./types.js";

export type GateDecisionKind = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface GateDecision {
  gateId: string;
  operation: OperationRequest;
  decision: GateDecisionKind;
  reason: string;
  approved: boolean;
}

export interface GateReport {
  outcome: GateDecisionKind;
  decisions: GateDecision[];
}

const humanGated = new Set([
  "delete",
  "network_access",
  "use_secret",
  "external_message",
  "git_push",
  "production_deploy",
  "database_migration",
]);

function gateId(handoffId: string, index: number, operation: OperationRequest): string {
  const digest = createHash("sha256")
    .update(`${handoffId}:${index}:${operation.type}:${operation.target}`)
    .digest("hex")
    .slice(0, 10);
  return `gate-${digest}`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
}

function isBroadDeleteTarget(target: string): boolean {
  const value = normalizePath(target);
  return ["", "/", ".", "..", "~", "$home", "%userprofile%", "c:", "d:"].includes(value);
}

function escapesWorkspace(target: string): boolean {
  const value = target.trim();
  const normalized = value.replace(/\\/g, "/");
  return posix.isAbsolute(normalized) || win32.isAbsolute(value) || normalized.split("/").includes("..");
}

function matchesAllowedPath(target: string, allowedPaths: string[]): boolean {
  const normalizedTarget = normalizePath(target);
  return allowedPaths.some((allowedPath) => {
    const pattern = normalizePath(allowedPath);
    if (["*", "**", "**/*", "."].includes(pattern)) return !escapesWorkspace(target);
    const prefix = pattern.replace(/\/\*\*.*$/, "").replace(/\/\*$/, "");
    return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`);
  });
}

function decideOperation(operation: OperationRequest, allowedPaths: string[]): { decision: GateDecisionKind; reason: string } {
  if (["read", "write", "delete"].includes(operation.type) && escapesWorkspace(operation.target)) {
    return { decision: "DENY", reason: "文件操作目标必须是工作区相对路径，禁止绝对路径和父目录穿越" };
  }

  if (operation.type === "delete" && isBroadDeleteTarget(operation.target)) {
    return { decision: "DENY", reason: "禁止删除工作区、磁盘根目录或用户主目录等宽泛目标" };
  }

  if (["read", "write", "delete"].includes(operation.type) && !matchesAllowedPath(operation.target, allowedPaths)) {
    return { decision: "DENY", reason: "目标不在 Handoff 声明的 allowedPaths 内" };
  }

  if (operation.type === "install_dependency" && /global|system|machine|program files|全局|系统/i.test(operation.target)) {
    return { decision: "REQUIRE_APPROVAL", reason: "全局或系统级软件安装必须人工确认；Windows 优先选择 D 盘" };
  }

  if (humanGated.has(operation.type)) {
    return { decision: "REQUIRE_APPROVAL", reason: "该操作会删除数据、访问外部系统、使用密钥或改变远端/生产状态" };
  }

  if (operation.risk === "high" || operation.risk === "critical") {
    return { decision: "REQUIRE_APPROVAL", reason: "Handoff 将该操作标记为高风险或关键风险" };
  }

  return { decision: "ALLOW", reason: "已声明的低风险工作区内操作" };
}

export function evaluateSafetyGate(handoff: Handoff, approvedGateIds: string[] = []): GateReport {
  const approvals = new Set(approvedGateIds);
  const decisions = handoff.requestedOperations.map((operation, index): GateDecision => {
    const id = gateId(handoff.id, index, operation);
    const raw = decideOperation(operation, handoff.workspace.allowedPaths);
    const approved = raw.decision === "REQUIRE_APPROVAL" && approvals.has(id);
    return {
      gateId: id,
      operation,
      decision: approved ? "ALLOW" : raw.decision,
      reason: approved ? `${raw.reason}；已由人工批准 ${id}` : raw.reason,
      approved,
    };
  });

  const outcome = decisions.some((item) => item.decision === "DENY")
    ? "DENY"
    : decisions.some((item) => item.decision === "REQUIRE_APPROVAL")
      ? "REQUIRE_APPROVAL"
      : "ALLOW";

  return { outcome, decisions };
}
