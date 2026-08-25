import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
const humanGated = new Set([
    "delete",
    "network_access",
    "use_secret",
    "external_message",
    "git_push",
    "production_deploy",
    "database_migration",
    "global_write",
    "purchase",
    "scope_expansion",
]);
function gateId(handoffId, index, operation) {
    const digest = createHash("sha256")
        .update(`${handoffId}:${index}:${operation.type}:${operation.target}`)
        .digest("hex")
        .slice(0, 10);
    return `gate-${digest}`;
}
function normalizePath(value) {
    return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
}
function isBroadDeleteTarget(target) {
    const value = normalizePath(target);
    return ["", "/", ".", "..", "~", "$home", "%userprofile%", "c:", "d:"].includes(value);
}
function escapesWorkspace(target) {
    const value = target.trim();
    const normalized = value.replace(/\\/g, "/");
    return posix.isAbsolute(normalized) || win32.isAbsolute(value) || normalized.split("/").includes("..");
}
function matchesAllowedPath(target, allowedPaths) {
    const normalizedTarget = normalizePath(target);
    return allowedPaths.some((allowedPath) => {
        const pattern = normalizePath(allowedPath);
        if (["*", "**", "**/*", "."].includes(pattern))
            return !escapesWorkspace(target);
        const prefix = pattern.replace(/\/\*\*.*$/, "").replace(/\/\*$/, "");
        return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`);
    });
}
/**
 * Synchronous gating cannot prove DNS resolution or ownership for an arbitrary
 * hostname. Auto-allow only this reviewed, exact-host documentation set; every
 * other valid HTTPS URL remains available through an operation approval.
 */
export const autoAllowedNetworkReadHosts = new Set([
    "developers.openai.com",
    "docs.github.com",
    "github.com",
    "help.openai.com",
    "learn.chatgpt.com",
    "openai.com",
    "platform.openai.com",
    "raw.githubusercontent.com",
    "www.openai.com",
]);
const privateNameSuffixes = [".corp", ".home", ".internal", ".intranet", ".lan", ".local", ".localhost", ".private"];
const sensitiveQueryNames = ["accesskey", "apikey", "auth", "authorization", "callback", "continue", "cookie", "credential", "destination", "key", "next", "password", "passwd", "redirect", "return", "secret", "session", "signature", "token", "url"];
function isIpLiteral(host) {
    const unwrapped = host.replace(/^\[|\]$/g, "");
    if (unwrapped.includes(":"))
        return true;
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(unwrapped);
}
function hasSensitiveQuery(url) {
    for (const name of url.searchParams.keys()) {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (sensitiveQueryNames.some((sensitive) => normalized.includes(sensitive)))
            return true;
    }
    return false;
}
function isProvablyPublicRead(target) {
    try {
        const url = new URL(target.trim());
        if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash || hasSensitiveQuery(url))
            return false;
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!host || host === "localhost" || !host.includes(".") || privateNameSuffixes.some((suffix) => host.endsWith(suffix)) || isIpLiteral(host))
            return false;
        return autoAllowedNetworkReadHosts.has(host);
    }
    catch {
        return false;
    }
}
function decideOperation(operation, allowedPaths) {
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
    if (operation.type === "network_read" && !isProvablyPublicRead(operation.target)) {
        return { decision: "REQUIRE_APPROVAL", reason: "同步安全门只自动放行经过审查的精确文档主机；其他 HTTPS、IP/内网、认证信息、敏感查询或片段必须人工确认" };
    }
    if (humanGated.has(operation.type)) {
        return { decision: "REQUIRE_APPROVAL", reason: "该操作会删除数据、访问外部系统、使用密钥或改变远端/生产状态" };
    }
    if (operation.risk === "high" || operation.risk === "critical") {
        return { decision: "REQUIRE_APPROVAL", reason: "Handoff 将该操作标记为高风险或关键风险" };
    }
    return { decision: "ALLOW", reason: operation.type === "network_read" ? "精确审查主机上的只读 HTTPS；任何重定向、目标或效果变化必须重新进入 gate" : "已声明的低风险工作区内操作" };
}
export function evaluateSafetyGate(handoff, approvedGateIds = []) {
    const approvals = new Set(approvedGateIds);
    const decisions = handoff.requestedOperations.map((operation, index) => {
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
