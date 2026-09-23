export function delegationDeclined(text) {
    return /(?:不要|不必|无需|禁止|不得|不创建|不使用).{0,10}(?:委派|子代理|子智能体|subagent)|(?:do not|don't|without|no)\s+(?:\w+\s+){0,3}(?:delegat\w*|subagents?)/i.test(text);
}
/** Conservative text fallback; the parent may supply facts already observed in this phase.
 * Missing facts mean Direct, not an extra model call to estimate those facts.
 */
export function assessDelegationBenefit(text, evidence) {
    if (delegationDeclined(text))
        return { worthwhile: false, reason: "delegation-declined" };
    if (!evidence) {
        const complete = /独立(?:交付|实现|完成).{0,24}(?:完整|整个)|(?:whole[- ]task|end[- ]to[- ]end|self-contained)\s+(?:implementation|deliverable)/i.test(text);
        const contract = /(?:固定|冻结|既定|明确)的?(?:接口|规格|契约)|(?:fixed|frozen)\s+(?:interface|specification|contract)/i.test(text);
        const acceptance = /(?:固定|冻结|既定|现有)的?验收测试|(?:fixed|frozen|existing)\s+acceptance\s+tests/i.test(text);
        const integration = /父(?:任务|代理)只(?:做|负责)(?:集成|验收)|parent\s+(?:only\s+)?(?:integrates|verifies)/i.test(text);
        const costly = /紧密耦合|相互依赖|仅改一行|小辅助函数|父(?:任务|代理).{0,8}(?:仍负责大部分|阻塞|重复实现)|tightly[- ]coupled|tiny\s+helper|one[- ]line|parent\s+(?:blocked|duplicates)/i.test(text);
        if (!(complete && contract && acceptance && integration) || costly) {
            return { worthwhile: false, reason: "delegation-benefit-not-established" };
        }
        evidence = { boundary: "whole-task", contract: "fixed", acceptance: "ready", work: "substantial", parentWork: "integration-only" };
    }
    if (evidence.contract !== "fixed" || evidence.acceptance !== "ready" || evidence.work !== "substantial") {
        return { worthwhile: false, reason: "delegation-contract-or-work-insufficient" };
    }
    const whole = evidence.boundary === "whole-task" && evidence.parentWork === "integration-only";
    // Keep legacy evidence readable; a slice does not establish whole-task transfer.
    // Parallel ownership is intentionally disabled pending connected evidence.
    return whole
        ? { worthwhile: true, reason: "substantial-independent-deliverable" }
        : { worthwhile: false, reason: "parent-coordination-would-dominate" };
}
