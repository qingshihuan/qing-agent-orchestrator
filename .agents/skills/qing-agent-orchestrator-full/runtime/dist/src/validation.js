import { isAbsolute } from "node:path";
const categories = new Set([
    "advice",
    "analysis",
    "code_change",
    "content_creation",
    "infrastructure",
    "external_action",
    "mixed",
]);
const operations = new Set([
    "read",
    "write",
    "delete",
    "execute_tests",
    "install_dependency",
    "network_read",
    "network_access",
    "use_secret",
    "external_message",
    "git_commit",
    "git_push",
    "production_deploy",
    "database_migration",
    "global_write",
    "purchase",
    "scope_expansion",
]);
const runPhases = new Set([
    "created",
    "preflight",
    "auditing",
    "executing",
    "reviewing",
    "completed",
    "failed",
    "cancelled",
    "blocked",
]);
const runStatuses = new Set([
    "active",
    "completed",
    "failed",
    "cancelled",
    "blocked",
    "max-iterations",
    "human-review",
]);
const processStates = new Set([
    "not-started",
    "running",
    "exited",
    "cancelled",
    "timed-out",
    "failed",
    "unknown",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function stringArray(value) {
    return Array.isArray(value) && value.every(nonEmptyString);
}
const relayEvents = new Set(["process.started", "process.exited", "process.heartbeat", "sandbox.preflight"]);
const relayPayloadFields = {
    "process.started": { pid: "number" },
    "process.exited": { exitCode: "nullable-number", state: "string" },
    "process.heartbeat": { iteration: "number", pid: "number", elapsedMs: "number" },
    "sandbox.preflight": { ok: "boolean", effectiveSandbox: "string", requiresHumanReview: "boolean" },
};
function validateRelayVerification(value, path, errors) {
    if (!isRecord(value)) {
        errors.push(path + " must be an object");
        return;
    }
    const common = ["kind", "eventType", "operator", "expected"];
    const allowed = new Set(value.kind === "event-payload" ? [...common, "field"] : common);
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            errors.push(path + " has unknown field: " + key);
    if (!relayEvents.has(String(value.eventType)))
        errors.push(path + ".eventType is invalid");
    if (value.kind === "event-count") {
        if (!["eq", "gte", "lte"].includes(String(value.operator)))
            errors.push(path + ".operator is invalid for event-count");
        if (!Number.isSafeInteger(value.expected) || Number(value.expected) < 0 || Number(value.expected) > 1_000_000)
            errors.push(path + ".expected must be an integer from 0 to 1000000");
        return;
    }
    if (value.kind !== "event-payload") {
        errors.push(path + ".kind is invalid");
        return;
    }
    if (!["eq", "ne", "gte", "lte"].includes(String(value.operator)))
        errors.push(path + ".operator is invalid for event-payload");
    if (!nonEmptyString(value.field)) {
        errors.push(path + ".field is required");
        return;
    }
    const fieldType = relayPayloadFields[String(value.eventType)]?.[value.field];
    if (!fieldType) {
        errors.push(path + ".field is not allowed for the selected eventType");
        return;
    }
    const expected = value.expected;
    const typeOk = fieldType === "nullable-number" ? expected === null || (typeof expected === "number" && Number.isFinite(expected))
        : fieldType === "number" ? typeof expected === "number" && Number.isFinite(expected)
            : typeof expected === fieldType;
    if (!typeOk)
        errors.push(path + ".expected type does not match the selected payload field");
    if ((value.operator === "gte" || value.operator === "lte") && fieldType !== "number")
        errors.push(path + ".operator requires a numeric payload field");
    if (typeof expected === "number" && (!Number.isSafeInteger(expected) || Math.abs(expected) > 1_000_000_000))
        errors.push(path + ".expected number is out of bounds");
}
export function validateHandoff(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["handoff must be an object"] };
    if (value.version !== "1.0")
        errors.push("version must be '1.0'");
    for (const key of ["id", "title", "objective"]) {
        if (!nonEmptyString(value[key]))
            errors.push(key + " must be a non-empty string");
    }
    if (!categories.has(String(value.category)))
        errors.push("category is invalid");
    if (!isRecord(value.workspace)) {
        errors.push("workspace must be an object");
    }
    else {
        if (!nonEmptyString(value.workspace.root))
            errors.push("workspace.root must be a non-empty string");
        if (!stringArray(value.workspace.allowedPaths) || value.workspace.allowedPaths.length === 0) {
            errors.push("workspace.allowedPaths must contain at least one path");
        }
        else if (value.workspace.allowedPaths.some((path) => isAbsolute(path) || path.replace(/\\/g, "/").split("/").includes(".."))) {
            errors.push("workspace.allowedPaths must use workspace-relative paths without parent traversal");
        }
    }
    if (!Array.isArray(value.inputs))
        errors.push("inputs must be an array");
    if (!stringArray(value.constraints))
        errors.push("constraints must be an array of non-empty strings");
    if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0) {
        errors.push("acceptanceCriteria must contain at least one item");
    }
    else {
        const ids = new Set();
        value.acceptanceCriteria.forEach((criterion, index) => {
            if (!isRecord(criterion)) {
                errors.push("acceptanceCriteria[" + index + "] must be an object");
                return;
            }
            if (!nonEmptyString(criterion.id))
                errors.push("acceptanceCriteria[" + index + "].id is required");
            if (!nonEmptyString(criterion.description))
                errors.push("acceptanceCriteria[" + index + "].description is required");
            if (!nonEmptyString(criterion.verification))
                errors.push("acceptanceCriteria[" + index + "].verification is required");
            if (!["executor", "relay", "hybrid"].includes(String(criterion.verificationOwner)))
                errors.push("acceptanceCriteria[" + index + "].verificationOwner is invalid");
            const criterionPath = "acceptanceCriteria[" + index + "]";
            for (const key of Object.keys(criterion))
                if (!["id", "description", "verification", "verificationOwner", "relayVerification"].includes(key))
                    errors.push(criterionPath + " has unknown field: " + key);
            if (criterion.verificationOwner === "relay" || criterion.verificationOwner === "hybrid") {
                if (criterion.relayVerification === undefined)
                    errors.push(criterionPath + ".relayVerification is required for relay/hybrid owner");
                else
                    validateRelayVerification(criterion.relayVerification, criterionPath + ".relayVerification", errors);
            }
            else if (criterion.relayVerification !== undefined)
                errors.push(criterionPath + ".relayVerification is forbidden for executor owner");
            if (nonEmptyString(criterion.id)) {
                if (ids.has(criterion.id))
                    errors.push("duplicate acceptance criterion id: " + criterion.id);
                ids.add(criterion.id);
            }
        });
    }
    if (!Array.isArray(value.requestedOperations)) {
        errors.push("requestedOperations must be an array");
    }
    else {
        value.requestedOperations.forEach((operation, index) => {
            if (!isRecord(operation)) {
                errors.push("requestedOperations[" + index + "] must be an object");
                return;
            }
            if (!operations.has(String(operation.type)))
                errors.push("requestedOperations[" + index + "].type is invalid");
            if (!nonEmptyString(operation.target))
                errors.push("requestedOperations[" + index + "].target is required");
            if (!nonEmptyString(operation.reason))
                errors.push("requestedOperations[" + index + "].reason is required");
            if (!["low", "medium", "high", "critical"].includes(String(operation.risk))) {
                errors.push("requestedOperations[" + index + "].risk is invalid");
            }
        });
    }
    if (!Array.isArray(value.deliverables))
        errors.push("deliverables must be an array");
    if (!stringArray(value.testPlan))
        errors.push("testPlan must be an array of non-empty strings");
    if (!Number.isInteger(value.maxIterations) || Number(value.maxIterations) < 1 || Number(value.maxIterations) > 5) {
        errors.push("maxIterations must be an integer from 1 to 5");
    }
    if (value.orchestration !== undefined) {
        if (!isRecord(value.orchestration)) {
            errors.push("orchestration must be an object");
        }
        else {
            const contract = value.orchestration;
            for (const key of Object.keys(contract)) {
                if (!["tier", "childAgentBudget", "independentReviewer", "maxRevisions"].includes(key))
                    errors.push("orchestration has unknown field: " + key);
            }
            if (!["direct", "lite", "full"].includes(String(contract.tier)))
                errors.push("orchestration.tier is invalid");
            if (!Number.isInteger(contract.childAgentBudget) || Number(contract.childAgentBudget) < 0 || Number(contract.childAgentBudget) > 8)
                errors.push("orchestration.childAgentBudget must be an integer from 0 to 8");
            if (typeof contract.independentReviewer !== "boolean")
                errors.push("orchestration.independentReviewer must be a boolean");
            if (!Number.isInteger(contract.maxRevisions) || Number(contract.maxRevisions) < 0 || Number(contract.maxRevisions) > 5)
                errors.push("orchestration.maxRevisions must be an integer from 0 to 5");
            if (contract.tier === "direct" && (contract.childAgentBudget !== 0 || contract.independentReviewer !== false || contract.maxRevisions !== 0))
                errors.push("direct orchestration requires 0 children, no independent Reviewer, and 0 revisions");
            if (contract.tier === "lite" && (contract.childAgentBudget !== 1 || contract.independentReviewer !== false || contract.maxRevisions !== 1))
                errors.push("lite orchestration requires 1 child, no independent Reviewer, and 1 revision");
            if (contract.tier === "full" && (!(typeof contract.childAgentBudget === "number" && contract.childAgentBudget >= 1) || contract.independentReviewer !== true || !(typeof contract.maxRevisions === "number" && contract.maxRevisions >= 1)))
                errors.push("full orchestration requires at least 1 child, an independent Reviewer, and at least 1 revision");
            if (Number.isInteger(value.maxIterations) && Number.isInteger(contract.maxRevisions) && Number(value.maxIterations) > Number(contract.maxRevisions) + 1)
                errors.push("maxIterations exceeds orchestration.maxRevisions + 1");
        }
    }
    return errors.length === 0
        ? { ok: true, errors, value: value }
        : { ok: false, errors };
}
export function validateRelayCriterionEvidence(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["relay criterion evidence must be an object"] };
    const allowed = new Set(["version", "evidenceId", "source", "runId", "handoffId", "criterionId", "iteration", "result", "evidence", "recordedAt"]);
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            errors.push("unknown relay criterion evidence field: " + key);
    if (value.version !== "1.0")
        errors.push("version must be '1.0'");
    for (const key of ["evidenceId", "runId", "handoffId", "criterionId", "evidence"]) {
        if (!nonEmptyString(value[key]))
            errors.push(key + " must be a non-empty string");
    }
    if (value.source !== "relay")
        errors.push("source must be 'relay'");
    if (!Number.isInteger(value.iteration) || Number(value.iteration) < 1)
        errors.push("iteration must be a positive integer");
    if (!["pass", "fail"].includes(String(value.result)))
        errors.push("result is invalid");
    if (!nonEmptyString(value.recordedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value.recordedAt)) || Number.isNaN(Date.parse(String(value.recordedAt))))
        errors.push("recordedAt must be a valid UTC date-time");
    return errors.length === 0 ? { ok: true, errors, value: value } : { ok: false, errors };
}
export function validateExecutionResult(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["execution result must be an object"] };
    const allowedRootKeys = new Set([
        "status",
        "summary",
        "artifacts",
        "criteriaEvidence",
        "tests",
        "proposedOperations",
        "simulated",
    ]);
    for (const key of Object.keys(value)) {
        if (!allowedRootKeys.has(key))
            errors.push("unknown execution result field: " + key);
    }
    if (!["succeeded", "failed", "skipped"].includes(String(value.status)))
        errors.push("status is invalid");
    if (!nonEmptyString(value.summary))
        errors.push("summary is required");
    if (!Array.isArray(value.artifacts)) {
        errors.push("artifacts must be an array");
    }
    else {
        value.artifacts.forEach((artifact, index) => {
            if (!isRecord(artifact)) {
                errors.push("artifacts[" + index + "] must be an object");
                return;
            }
            if (!nonEmptyString(artifact.path))
                errors.push("artifacts[" + index + "].path is required");
            if (!nonEmptyString(artifact.description))
                errors.push("artifacts[" + index + "].description is required");
        });
    }
    if (!Array.isArray(value.criteriaEvidence)) {
        errors.push("criteriaEvidence must be an array");
    }
    else {
        value.criteriaEvidence.forEach((criterion, index) => {
            if (!isRecord(criterion)) {
                errors.push("criteriaEvidence[" + index + "] must be an object");
                return;
            }
            if (!nonEmptyString(criterion.id))
                errors.push("criteriaEvidence[" + index + "].id is required");
            if (!["pass", "fail", "not_verified"].includes(String(criterion.status))) {
                errors.push("criteriaEvidence[" + index + "].status is invalid");
            }
            if (typeof criterion.evidence !== "string")
                errors.push("criteriaEvidence[" + index + "].evidence must be a string");
        });
    }
    if (!Array.isArray(value.tests)) {
        errors.push("tests must be an array");
    }
    else {
        value.tests.forEach((test, index) => {
            if (!isRecord(test)) {
                errors.push("tests[" + index + "] must be an object");
                return;
            }
            if (!nonEmptyString(test.command))
                errors.push("tests[" + index + "].command is required");
            if (!["passed", "failed", "not_run"].includes(String(test.status)))
                errors.push("tests[" + index + "].status is invalid");
            if (typeof test.evidence !== "string")
                errors.push("tests[" + index + "].evidence must be a string");
        });
    }
    if (!Array.isArray(value.proposedOperations)) {
        errors.push("proposedOperations must be an array");
    }
    else {
        value.proposedOperations.forEach((operation, index) => {
            if (!isRecord(operation)) {
                errors.push("proposedOperations[" + index + "] must be an object");
                return;
            }
            if (!operations.has(String(operation.type)))
                errors.push("proposedOperations[" + index + "].type is invalid");
            if (!nonEmptyString(operation.target))
                errors.push("proposedOperations[" + index + "].target is required");
            if (!nonEmptyString(operation.reason))
                errors.push("proposedOperations[" + index + "].reason is required");
            if (!["low", "medium", "high", "critical"].includes(String(operation.risk))) {
                errors.push("proposedOperations[" + index + "].risk is invalid");
            }
        });
    }
    if (typeof value.simulated !== "boolean")
        errors.push("simulated must be a boolean");
    return errors.length === 0
        ? { ok: true, errors, value: value }
        : { ok: false, errors };
}
export function validateReview(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["review must be an object"] };
    if (value.version !== "1.0")
        errors.push("version must be '1.0'");
    if (!nonEmptyString(value.handoffId))
        errors.push("handoffId is required");
    if (!Number.isInteger(value.iteration) || Number(value.iteration) < 1)
        errors.push("iteration must be >= 1");
    if (!["PASS", "REVISE", "HUMAN_REVIEW"].includes(String(value.verdict)))
        errors.push("verdict is invalid");
    if (!nonEmptyString(value.summary))
        errors.push("summary is required");
    for (const key of ["criteria", "criterionAudit", "findings", "tests", "revisionInstructions"]) {
        if (!Array.isArray(value[key]))
            errors.push(key + " must be an array");
    }
    return errors.length === 0
        ? { ok: true, errors, value: value }
        : { ok: false, errors };
}
function validateIdArray(value, name, errors) {
    const ids = new Set();
    if (!Array.isArray(value) || value.length === 0) {
        errors.push(name + " must contain at least one item");
        return ids;
    }
    value.forEach((item, index) => {
        if (!isRecord(item)) {
            errors.push(name + "[" + index + "] must be an object");
            return;
        }
        if (!nonEmptyString(item.id))
            errors.push(name + "[" + index + "].id is required");
        else if (ids.has(item.id))
            errors.push("duplicate " + name + " id: " + item.id);
        else
            ids.add(item.id);
    });
    return ids;
}
export function validateAcceptanceEvidence(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["acceptance evidence must be an object"] };
    if (value.version !== "1.0")
        errors.push("version must be '1.0'");
    if (!nonEmptyString(value.id))
        errors.push("id is required");
    if (!nonEmptyString(value.title))
        errors.push("title is required");
    const setupIds = validateIdArray(value.seededSetup, "seededSetup", errors);
    const actionIds = validateIdArray(value.actions, "actions", errors);
    const assertionIds = validateIdArray(value.assertions, "assertions", errors);
    if (Array.isArray(value.seededSetup)) {
        value.seededSetup.forEach((item, index) => {
            if (!isRecord(item))
                return;
            if (!["seed", "reset", "authenticate", "fixture", "navigate"].includes(String(item.action))) {
                errors.push("seededSetup[" + index + "].action is invalid");
            }
            if (!nonEmptyString(item.target))
                errors.push("seededSetup[" + index + "].target is required");
            if (item.value !== undefined && typeof item.value !== "string")
                errors.push("seededSetup[" + index + "].value must be a string");
        });
    }
    if (Array.isArray(value.actions)) {
        value.actions.forEach((item, index) => {
            if (!isRecord(item))
                return;
            if (!["navigate", "click", "type", "select", "wait", "submit"].includes(String(item.action))) {
                errors.push("actions[" + index + "].action is invalid");
            }
            if (!nonEmptyString(item.target))
                errors.push("actions[" + index + "].target is required");
            if (item.value !== undefined && typeof item.value !== "string")
                errors.push("actions[" + index + "].value must be a string");
        });
    }
    if (Array.isArray(value.assertions)) {
        value.assertions.forEach((item, index) => {
            if (!isRecord(item))
                return;
            if (!nonEmptyString(item.description))
                errors.push("assertions[" + index + "].description is required");
            if (!nonEmptyString(item.target))
                errors.push("assertions[" + index + "].target is required");
            if (!nonEmptyString(item.expected))
                errors.push("assertions[" + index + "].expected is required");
        });
    }
    if (!Array.isArray(value.observedEvidence) || value.observedEvidence.length === 0) {
        errors.push("observedEvidence must contain at least one item");
    }
    else {
        const observedIds = new Set();
        value.observedEvidence.forEach((item, index) => {
            if (!isRecord(item)) {
                errors.push("observedEvidence[" + index + "] must be an object");
                return;
            }
            if (!nonEmptyString(item.assertionId))
                errors.push("observedEvidence[" + index + "].assertionId is required");
            if (!nonEmptyString(item.observed))
                errors.push("observedEvidence[" + index + "].observed is required");
            if (typeof item.passed !== "boolean")
                errors.push("observedEvidence[" + index + "].passed must be a boolean");
            if (!nonEmptyString(item.evidence))
                errors.push("observedEvidence[" + index + "].evidence is required");
            if (nonEmptyString(item.assertionId)) {
                if (observedIds.has(item.assertionId))
                    errors.push("duplicate observed assertion id: " + item.assertionId);
                observedIds.add(item.assertionId);
                if (assertionIds.size > 0 && !assertionIds.has(item.assertionId)) {
                    errors.push("observedEvidence[" + index + "] references an unknown assertion");
                }
            }
        });
        for (const assertionId of assertionIds) {
            if (!observedIds.has(assertionId))
                errors.push("missing observed evidence for assertion: " + assertionId);
        }
        if (value.result !== "passed" && value.result !== "failed")
            errors.push("result must be passed or failed");
        else if (value.result === "passed" && value.observedEvidence.some((item) => isRecord(item) && item.passed !== true)) {
            errors.push("passed result requires every observed assertion to pass");
        }
        else if (value.result === "failed" && value.observedEvidence.every((item) => isRecord(item) && item.passed === true)) {
            errors.push("failed result requires at least one failed observed assertion");
        }
    }
    return errors.length === 0
        ? { ok: true, errors, value: value }
        : { ok: false, errors };
}
export function validateRunRecord(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["run record must be an object"] };
    if (value.version !== "1.0")
        errors.push("version must be '1.0'");
    for (const key of ["runId", "handoffId", "startedAt", "updatedAt", "artifactDirectory"]) {
        if (!nonEmptyString(value[key]))
            errors.push(key + " is required");
    }
    if (!runPhases.has(String(value.phase)))
        errors.push("phase is invalid");
    if (!runStatuses.has(String(value.status)))
        errors.push("status is invalid");
    if (!Number.isInteger(value.iteration) || Number(value.iteration) < 0)
        errors.push("iteration must be >= 0");
    if (!processStates.has(String(value.processState)))
        errors.push("processState is invalid");
    if (value.completedAt !== null && !nonEmptyString(value.completedAt))
        errors.push("completedAt must be null or a string");
    if (!isRecord(value.artifacts)) {
        errors.push("artifacts must be an object");
    }
    else {
        for (const key of ["handoff", "events", "process", "executorResult", "review", "finalSummary", "gitBefore", "gitAfter", "gitAudit", "sandboxPreflight"]) {
            if (!nonEmptyString(value.artifacts[key]))
                errors.push("artifacts." + key + " is required");
        }
    }
    if (value.lastEvent !== null && !isRecord(value.lastEvent))
        errors.push("lastEvent must be null or an object");
    return errors.length === 0
        ? { ok: true, errors, value: value }
        : { ok: false, errors };
}
