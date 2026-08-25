import { randomUUID } from "node:crypto";
import { detectCliReasonCodes, routeExecutionMode } from "./execution-mode-router.js";
import { decideOrchestration } from "./orchestration-policy.js";
import { createHandoffOrchestrationContract } from "./orchestration-policy.js";
import { analyzeTaskComplexity } from "./task-analyzer.js";
const code = /实现|修复|重构|写代码|修改|新增|删除|build|implement|fix|refactor|code|edit/i;
const analysis = /分析|诊断|审查|评估|检查|核对|只读|analy[sz]e|diagnose|review|assess|inspect|audit|read[- ]only/i;
const advice = /解释|说明|建议|怎么|是什么|为什么|explain|advise|how|what|why/i;
const content = /文档|报告|演示|设计稿|document|report|presentation|copywriting/i;
const infrastructure = /部署|上线|生产环境|数据库迁移|服务器|deploy|production|migration|terraform|kubernetes/i;
const external = /发送|发布|通知|邮件|消息|send|publish|email|message|notify/i;
const sequence = /先.+(?:再|然后|之后)|规划.+(?:执行|实现)|plan.+(?:then|and).+(?:implement|execute)/i;
const orchestrationExecution = /多个(?:互相)?独立(?:任务|工作流|工作项)|并行(?:任务|工作流|实现|审查)|parallel\s+(?:tasks?|workstreams?)|independent\s+workstreams?|(?:启动|使用|采用|进入).{0,10}(?:Level\s*3|完整(?:版)?\s*Qing|完整编排|全量编排)|full(?:\s+qing|\s+orchestration)/i;
const deleteAction = /删除|清空|移除|delete|remove/i;
const gitPushAction = /(?:Git\s*)?推送|git\s+push|push\s+(?:to|branch|tag|origin)/i;
const purchaseAction = /购买|支付|付费|purchase|payment|buy\b/i;
const globalWriteAction = /全局|系统级|系统范围|global|system[- ]wide/i;
const globalWriteVerb = /修改|写入|更新|编辑|更改|重启|启动|停止|启用|禁用|change|modify|write|update|edit|restart|start|stop|enable|disable/i;
const secretAction = /使用|读取|访问|导入|use|read|access|load/i;
const secretTarget = /密钥|凭据|令牌|secret|credential|token/i;
const privateNetworkAction = /私有|内网|认证(?:接口|网络|服务)|private|internal\s+network|authenticated/i;
const scopeExpansionAction = /(?:扩大|扩展|新增)(?:任务|工作)?范围|scope\s+expansion|expand\s+(?:the\s+)?scope/i;
const databaseMigrationAction = /数据库迁移|破坏性迁移|database\s+migration|destructive\s+migration/i;
const globalInstallAction = /(?:全局|系统级|系统范围).{0,12}(?:安装|升级(?:软件|依赖|工具|程序|包))|(?:安装|升级(?:软件|依赖|工具|程序|包)).{0,12}(?:全局|系统级|系统范围)|npm\s+(?:install|i)\s+-g|(?:install|upgrade).{0,12}(?:global|system[- ]wide)/i;
const cliExecutionIntent = /接入|配置|搭建|启用|启动|切换|改用|使用|运行|执行|继续|提供|输出|放入|迁移|自动化|完成|integrate|configure|set\s*up|enable|start|switch|use|run|execute|continue|provide|output|move|migrate|automate|complete/i;
/** Remove only negated high-risk terms so "不要发布" cannot create a high-risk route signal. */
export function stripNegatedRiskTerms(text) {
    return text
        .replace(/(?:不|不要|不得|无需|禁止|避免|不会|不允许)[^，。；;,.]{0,12}(部署|上线|发布|发送|通知|邮件|消息|生产环境|数据库迁移|破坏性迁移|服务器|删除|清空|推送|购买|支付|全局修改|系统修改|全局安装|系统级安装|密钥|凭据|私有网络|认证服务|(?:扩大|扩展)(?:任务|工作)?范围)/gi, " ")
        .replace(/\b(?:do\s+not|don't|never|without|no)\s+(?:\w+\s+){0,4}(deploy|publish|send|email|message|notify|migrate|delete|remove|push|purchase|pay|use\s+secret|install\s+globally|expand\s+(?:the\s+)?scope)\b/gi, " ");
}
export function routeTask(text, options = {}) {
    const task = text.trim();
    if (!task)
        throw new Error("Task text must not be empty.");
    const effective = stripNegatedRiskTerms(task);
    const signals = [];
    if (code.test(effective))
        signals.push("code-change");
    if (analysis.test(effective))
        signals.push("analysis");
    if (advice.test(effective))
        signals.push("advice");
    if (content.test(effective))
        signals.push("content");
    if (infrastructure.test(effective))
        signals.push("infrastructure");
    if (external.test(effective))
        signals.push("external-action");
    if (sequence.test(effective))
        signals.push("plan-then-execute");
    if (orchestrationExecution.test(effective))
        signals.push("orchestration-execution");
    if (deleteAction.test(effective))
        signals.push("delete-action");
    if (gitPushAction.test(effective))
        signals.push("git-push-action");
    if (purchaseAction.test(effective))
        signals.push("purchase-action");
    if (globalWriteAction.test(effective) && globalWriteVerb.test(effective))
        signals.push("global-write-action");
    if (secretAction.test(effective) && secretTarget.test(effective))
        signals.push("secret-action");
    if (privateNetworkAction.test(effective) && /访问|读取|连接|调用|access|read|connect|call/i.test(effective))
        signals.push("private-network-action");
    if (scopeExpansionAction.test(effective))
        signals.push("scope-expansion-action");
    if (databaseMigrationAction.test(effective))
        signals.push("database-migration-action");
    if (globalInstallAction.test(effective))
        signals.push("global-install-action");
    const cliReasonCodes = detectCliReasonCodes(task);
    const hasReasoningOnlySignal = signals.some((value) => value === "advice" || value === "analysis");
    const explicitlyRequestsCli = cliReasonCodes.includes("explicit-cli-request");
    const actionableCliCondition = cliReasonCodes.length > 0
        && cliExecutionIntent.test(effective)
        && (explicitlyRequestsCli || !hasReasoningOnlySignal);
    if (actionableCliCondition)
        signals.push("cli-backend-condition");
    if (actionableCliCondition && !signals.some((value) => ["code-change", "content", "infrastructure", "external-action"].includes(value))) {
        signals.push("code-change");
    }
    const configuredFull = options.orchestration?.mode === "full";
    const hasExecution = configuredFull || signals.some((value) => ["code-change", "content", "infrastructure", "external-action", "orchestration-execution", "delete-action", "git-push-action", "purchase-action", "global-write-action", "secret-action", "private-network-action", "scope-expansion-action", "database-migration-action", "global-install-action"].includes(value));
    const materiallyMixed = configuredFull || signals.includes("plan-then-execute") || signals.includes("orchestration-execution")
        || (signals.includes("code-change") && signals.some((value) => ["infrastructure", "external-action"].includes(value)))
        || (signals.includes("infrastructure") && signals.includes("external-action"));
    const route = materiallyMixed ? "hybrid" : hasExecution ? "codex" : "chat";
    let category = "advice";
    if (materiallyMixed)
        category = "mixed";
    else if (signals.includes("infrastructure"))
        category = "infrastructure";
    else if (signals.includes("external-action"))
        category = "external_action";
    else if (signals.includes("code-change"))
        category = "code_change";
    else if (signals.includes("content"))
        category = "content_creation";
    else if (signals.includes("analysis"))
        category = "analysis";
    const complexity = analyzeTaskComplexity({ text: task, category, role: "planner", routeSignals: signals });
    const orchestration = decideOrchestration({ text: task, route, category, complexity, signals, config: options.orchestration });
    const reasons = orchestration.tier === "direct"
        ? [route === "chat" ? "目标可由外层主会话直接回答。" : "目标是范围明确、可逆的单一工作，由父任务直接完成并验证。"]
        : orchestration.tier === "lite"
            ? ["目标需要一次有界委派；最多创建一个 Executor，由父任务验证。"]
            : ["目标含高风险、跨系统、真正并行或显式完整编排信号，使用独立 Reviewer 的完整流程。"];
    const execution = routeExecutionMode(task, options.edition ?? "full", route, orchestration.tier);
    return {
        executionOwner: execution.executionOwner,
        route,
        confidence: signals.length === 0 ? "low" : materiallyMixed || signals.length === 1 ? "high" : "medium",
        category,
        reasons,
        signals,
        execution,
        complexity,
        orchestration,
    };
}
export function createPendingDispatchHandoff(task, workspace, decision) {
    if (decision.route === "chat")
        throw new Error("Chat routing must not create a Handoff.");
    const operations = [
        { type: "read", target: "**/*", reason: "Inspect only the project material required by the declared objective.", risk: "low" },
    ];
    if (decision.signals.some((signal) => ["code-change", "content"].includes(signal))) {
        operations.push({ type: "write", target: "**/*", reason: "Create only the declared project-local deliverables.", risk: "medium" }, { type: "execute_tests", target: "project-local tests", reason: "Verify the declared deliverables locally.", risk: "low" });
    }
    if (decision.signals.includes("infrastructure"))
        operations.push({ type: "production_deploy", target: "deployment target requires Planner refinement", reason: "The goal contains a real infrastructure action; retain it behind an explicit human gate.", risk: "high" });
    if (decision.signals.includes("external-action"))
        operations.push({ type: "external_message", target: "external target requires Planner refinement", reason: "The goal contains an external action; retain it behind an explicit human gate.", risk: "high" });
    if (decision.signals.includes("delete-action"))
        operations.push({ type: "delete", target: "deletion target requires Planner refinement", reason: "Deletion is a consequential effect and requires an exact target plus human approval.", risk: "high" });
    if (decision.signals.includes("git-push-action"))
        operations.push({ type: "git_push", target: "remote/ref requires Planner refinement", reason: "A remote Git push changes external state.", risk: "high" });
    if (decision.signals.includes("purchase-action"))
        operations.push({ type: "purchase", target: "purchase target and cost require Planner refinement", reason: "A purchase creates cost and an external side effect.", risk: "high" });
    if (decision.signals.includes("global-write-action"))
        operations.push({ type: "global_write", target: "global/system target requires Planner refinement", reason: "A global or system write changes state outside the project workspace.", risk: "high" });
    if (decision.signals.includes("secret-action"))
        operations.push({ type: "use_secret", target: "secret reference requires Planner refinement", reason: "Secret access requires an exact named reference and human approval.", risk: "high" });
    if (decision.signals.includes("private-network-action"))
        operations.push({ type: "network_access", target: "private/authenticated endpoint requires Planner refinement", reason: "Private or authenticated network access is not public read-only network_read.", risk: "high" });
    if (decision.signals.includes("scope-expansion-action"))
        operations.push({ type: "scope_expansion", target: "expanded scope requires Planner refinement", reason: "Material scope expansion needs fresh authority.", risk: "high" });
    if (decision.signals.includes("database-migration-action"))
        operations.push({ type: "database_migration", target: "database and migration plan require Planner refinement", reason: "A database migration can irreversibly change shared data.", risk: "critical" });
    if (decision.signals.includes("global-install-action"))
        operations.push({ type: "install_dependency", target: "global/system installation target requires Planner refinement", reason: "A global or system-level installation changes machine state.", risk: "high" });
    return {
        version: "1.0",
        id: `qing-dispatch-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
        title: task.trim().slice(0, 100),
        objective: task.trim(),
        category: decision.category,
        workspace: { root: workspace, allowedPaths: ["**/*"] },
        inputs: [{ name: "user-goal", type: "text", value: task.trim(), required: true }],
        constraints: [
            "Preserve unrelated files and existing user changes.",
            "Proceed without a separate plan approval when every declared operation is allowed by the safety gate.",
            "Any unlisted operation, material scope expansion, or unresolved remote target requires a revised Handoff and a new effect gate.",
        ],
        acceptanceCriteria: [{ id: "AC-OBJECTIVE", description: "The declared objective is completed and verified without expanding scope.", verification: "Executor returns concrete artifact and test evidence for the objective.", verificationOwner: "executor" }],
        requestedOperations: operations,
        deliverables: [],
        testPlan: operations.some(({ type }) => type === "execute_tests") ? ["Discover and run the project's relevant local test/build commands."] : [],
        maxIterations: Math.min(5, decision.orchestration.maxRevisions + 1),
        orchestration: createHandoffOrchestrationContract(decision.orchestration),
        metadata: { createdAt: new Date().toISOString(), source: "qing-dispatch-local-envelope" },
    };
}
