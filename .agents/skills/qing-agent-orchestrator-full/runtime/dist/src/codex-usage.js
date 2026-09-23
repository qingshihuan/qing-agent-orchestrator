/** Parse documented exec JSONL turn totals, not private rollout files or bills.
 * A completed turn may contain several model requests. Never label turns as requests.
 */
export function parseCodexUsage(stdout) {
    let completedTurns = 0;
    let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0;
    const problems = [];
    const integer = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    for (const line of stdout.split(/\r?\n/).filter(s => s.trim())) {
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            problems.push("invalid-jsonl");
            continue;
        }
        if (value?.type === "turn.failed" || value?.type === "error")
            problems.push("failed-turn-may-have-unreported-usage");
        if (value?.type !== "turn.completed")
            continue;
        const u = value.usage;
        if (!u || !integer(u.input_tokens) || !integer(u.cached_input_tokens) || !integer(u.output_tokens)
            || u.cached_input_tokens > u.input_tokens
            || (u.reasoning_output_tokens !== undefined && (!integer(u.reasoning_output_tokens) || u.reasoning_output_tokens > u.output_tokens))) {
            problems.push("missing-or-invalid-turn-usage");
            continue;
        }
        if (![inputTokens + u.input_tokens, cachedInputTokens + u.cached_input_tokens, outputTokens + u.output_tokens,
            inputTokens + u.input_tokens + outputTokens + u.output_tokens].every(integer)) {
            problems.push("usage-overflow");
            continue;
        }
        completedTurns++;
        inputTokens += u.input_tokens;
        cachedInputTokens += u.cached_input_tokens;
        outputTokens += u.output_tokens;
    }
    if (!completedTurns)
        problems.push("no-observed-usage");
    return {
        source: "codex-exec-turn.completed", completedTurns,
        totals: completedTurns ? { inputTokens, cachedInputTokens, outputTokens, totalTokens: inputTokens + outputTokens } : null,
        problems: [...new Set(problems)], modelRequestCount: null, costUsd: null,
        wholeTaskUsageComplete: false,
        excluded: ["outer-host-parent", "model-health-preflight", "unreported-failed-requests"],
    };
}
