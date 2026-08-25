const categoryWeight = {
    advice: 0,
    analysis: 2,
    content_creation: 2,
    code_change: 3,
    infrastructure: 4,
    external_action: 4,
    mixed: 5,
};
const roleWeight = { planner: 0, reviewer: 1, executor: 1 };
const riskWeight = { low: 0, medium: 2, high: 5, critical: 7 };
const highRiskSignals = new Set([
    "infrastructure",
    "external-action",
    "delete-action",
    "git-push-action",
    "purchase-action",
    "global-write-action",
    "secret-action",
    "private-network-action",
    "scope-expansion-action",
    "database-migration-action",
    "global-install-action",
]);
const complexitySignals = new Set([
    "plan-then-execute",
    "orchestration-execution",
    ...highRiskSignals,
]);
function inferRisk(category, routeSignals) {
    if (routeSignals.some((signal) => highRiskSignals.has(signal)))
        return "high";
    if (category === "infrastructure" || category === "external_action" || category === "mixed")
        return "medium";
    return category === "code_change" || category === "content_creation" ? "medium" : "low";
}
export function analyzeTaskComplexity(input) {
    const text = input.text.trim();
    if (!text)
        throw new Error("Task analyzer requires non-empty text.");
    const routeSignals = [...new Set(input.routeSignals ?? [])];
    const reasons = [];
    let score = categoryWeight[input.category];
    reasons.push(`category:${input.category}=+${categoryWeight[input.category]}`);
    score += roleWeight[input.role];
    reasons.push(`role:${input.role}=+${roleWeight[input.role]}`);
    const risk = input.risk ?? inferRisk(input.category, routeSignals);
    score += riskWeight[risk];
    reasons.push(`risk:${risk}=+${riskWeight[risk]}`);
    const crossSystem = /跨|多个仓库|多仓库|前后端|数据库.+(?:服务|应用)|CI|CD|pipeline|multiple repos?|cross[- ]system/i.test(text);
    const multiStep = routeSignals.includes("plan-then-execute") || /先.+(?:再|然后|之后)|并且|以及|then|and then/i.test(text);
    const scope = crossSystem ? "cross-system" : multiStep ? "multi-step" : "single";
    const scopeWeight = scope === "cross-system" ? 3 : scope === "multi-step" ? 2 : 0;
    score += scopeWeight;
    reasons.push(`scope:${scope}=+${scopeWeight}`);
    const distinctComplexitySignals = routeSignals.filter((signal) => complexitySignals.has(signal));
    const additionalSignals = Math.min(2, distinctComplexitySignals.length);
    if (additionalSignals > 0) {
        score += additionalSignals;
        reasons.push(`complexity-signals:${distinctComplexitySignals.length}=+${additionalSignals}`);
    }
    if (text.length >= 240) {
        score += 1;
        reasons.push("long-brief:+1");
    }
    const band = score <= 2 ? "trivial" : score <= 6 ? "normal" : score <= 10 ? "complex" : "high-risk";
    return { score, band, category: input.category, role: input.role, risk, scope, signals: routeSignals, reasons };
}
