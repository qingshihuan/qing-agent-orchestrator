from pathlib import Path
import textwrap

def change(path,old,new):
    p=Path(path); s=p.read_text(encoding='utf-8')
    assert s.count(old)==1,(path,old[:100],s.count(old))
    p.write_bytes(s.replace(old,new,1).encode('utf-8'))
change('tests/task-router.test.ts','assert.equal(fallback.status, "FULL_EXECUTION_READY");','assert.equal(fallback.status, "LITE_EXECUTION_REQUIRED");')
change('tests/task-router.test.ts','assert.match(String(fallback.handoffId), /^qing-dispatch-/);','assert.equal(fallback.handoffId, null);\n    assert.equal((fallback.orchestration as { independentReviewer: boolean }).independentReviewer, false);')

p='src/single-owner-controller.ts'
change(p,'import { captureGitSnapshot }','import { evaluateSafetyGate } from "./safety-gate.js";\nimport { captureGitSnapshot }')
change(p,'    const run = options.runHandle;','''    const run = options.runHandle;
    const statistics = () => ({
      mode: "single-owner" as const, managerModelCalls: 0, executorInvocations: invocations,
      automaticRetries: 0, independentReviewPerformed: false, verification: "deterministic-acceptance",
      usage, wholeTaskCostUsd: null, wholeTaskModelRequestCount: null,
    });
    const cancelledResult = () => ({
      handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED" as const,
      preflightGate: evaluateSafetyGate(handoff, options.approvedGateIds), attempts: [], phaseDecisions: [],
      message: "Run cancelled; no new acceptance or model invocation was started.", controller: statistics(),
    });''')
change(p,'    try {\n      if (!(await captureGitSnapshot','    try {\n      if (await run.isCancelled()) return cancelledResult();\n      if (!(await captureGitSnapshot')
change(p,'''      const controller = {
        mode: "single-owner" as const, managerModelCalls: 0, executorInvocations: invocations,
        automaticRetries: 0, independentReviewPerformed: false, verification: "deterministic-acceptance",
        usage, wholeTaskCostUsd: null, wholeTaskModelRequestCount: null,
      };''','''      if (await run.isCancelled()) return cancelledResult();
      const controller = statistics();''')
change(p,'    } finally {','''    } catch (error) {
      // RunStore correctly rejects writes after cancellation. Preserve that
      // terminal record instead of trying to finalize or append another event.
      if (await run.isCancelled()) return cancelledResult();
      throw error;
    } finally {''')
# Partial input freezing is not an OS-level sandbox or full dependency closure.
p=Path('docs/single-owner.md')
p.write_bytes((p.read_text(encoding='utf-8')+'\nThe nominated --protect files are integrity checked, not sandbox-mounted read-only. Callers must include the specification and all relevant acceptance inputs/dependencies. Root process exit is not proof that arbitrary background processes do not exist; the lease coordinates this adapter only. The injected Executor interface is trusted test/library code, not an attacker boundary. Cancellation leaves the RunStore terminal record intact.\n').encode('utf-8'))
print('Terminal cancellation preserved; legacy transport-only Full expectation migrated to Lite without dropping effect checks.')
