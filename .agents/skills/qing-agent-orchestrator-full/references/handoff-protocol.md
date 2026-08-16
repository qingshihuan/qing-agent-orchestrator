# Handoff protocol

A Handoff is the complete contract between Planner and Executor. Include:

- version and stable ID;
- observable objective and task category;
- exact workspace root and relative allowed paths;
- inputs and preservation constraints;
- testable acceptance criteria with verification owners;
- every requested read, write, command, dependency, network, secret, deletion, Git, deployment, message, or migration operation;
- deliverables and exact test plan;
- a bounded iteration count from one through five.

Show the full contract before approval. The exact Handoff approval does not automatically approve operation-specific gates. A revision preserves the objective and approved scope; additions require a new gate and approval.
