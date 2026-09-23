import { planModelCandidates, selectModelCandidate } from "./model-router.js";
/** One scheduler per CLI invocation, never a global account/entitlement cache. */
export class TaskModelScheduler {
    candidates;
    checker;
    constructor(candidates, checker) {
        this.candidates = candidates;
        this.checker = checker;
    }
    async select(request) {
        if (request.backend !== "codex-cli")
            throw new Error("CLI scheduler cannot probe a desktop backend.");
        // Use exactly the selector's ordered, tag/role/scope-filtered explicit chain.
        // Do not preflight unrelated models or healthy-primary fallbacks.
        const plan = planModelCandidates(this.candidates, new Map(), request);
        const byId = new Map(this.candidates.map(candidate => [candidate.id, candidate]));
        const health = [];
        for (const planned of plan.orderedCandidates) {
            const observed = await this.checker.check(byId.get(planned.candidateId));
            health.push(observed);
            if (observed.state === "healthy")
                break;
        }
        return { selection: selectModelCandidate(this.candidates, new Map(health.map(record => [record.candidateId, record])), request), health };
    }
    /** Called only after a concrete, selected-model rejection, not a task failure. */
    async prepareFallback(selection, reason) {
        if (!reason.trim())
            throw new Error("Runtime rejection requires a concrete reason.");
        const byId = new Map(this.candidates.map(candidate => [candidate.id, candidate]));
        const checked = (planned) => {
            const source = byId.get(planned.candidateId);
            if (!source || !source.enabled || !source.roles.includes(selection.role) ||
                !source.complexityBands.includes(selection.complexityBand) ||
                source.model !== planned.model || source.backend !== planned.backend ||
                source.profile !== planned.profile || source.reasoningEffort !== planned.reasoningEffort ||
                source.availability !== planned.availability || source.backend !== "codex-cli" ||
                source.profile !== selection.profile) {
                throw new Error("Fallback configuration changed; create a new selection and scope assessment.");
            }
            return source;
        };
        const ordered = selection.fallbackPlan.orderedCandidates.map(candidate => ({ ...candidate }));
        const index = ordered.findIndex(candidate => candidate.candidateId === selection.candidateId);
        if (index < 0)
            throw new Error("Selected model is absent from the fallback plan.");
        // Validate the entire remaining plan before any new process or cache write.
        const sources = ordered.slice(index).map(checked);
        await this.checker.invalidateAfterRejection(sources[0], reason);
        for (let offset = 1; offset < sources.length; offset += 1) {
            const observed = await this.checker.check(sources[offset]);
            const planned = ordered[index + offset];
            planned.observedState = observed.state;
            planned.cacheState = observed.cacheState;
            if (observed.state === "healthy")
                break;
        }
        // The existing fallback code still verifies all effect/sandbox scope proof.
        return { ...selection, fallbackPlan: { ...selection.fallbackPlan, orderedCandidates: ordered } };
    }
}
