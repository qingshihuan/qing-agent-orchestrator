import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureGitSnapshot, compareGitSnapshots } from "../src/git-audit.js";

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, windowsHide: true });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(error)));
  });
}

test("Git audit detects tracked edits, deletion, pre-existing untracked changes and scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-git-audit-"));
  try {
    await git(root, ["init"]); await git(root, ["config", "user.email", "fixture@example.invalid"]); await git(root, ["config", "user.name", "Fixture"]);
    await mkdir(join(root, "src")); await writeFile(join(root, "src", "a.txt"), "one"); await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture"]);
    await writeFile(join(root, "pre.txt"), "before");
    const before = await captureGitSnapshot(root);
    await writeFile(join(root, "pre.txt"), "after"); await rm(join(root, "src", "a.txt"));
    const audit = compareGitSnapshots(before, await captureGitSnapshot(root), ["src"]);
    assert.equal(audit.status, "out-of-scope"); assert.equal(audit.requiresHumanReview, true);
    assert.ok(audit.changedExistingPaths.includes("src/a.txt")); assert.ok(audit.changedExistingPaths.includes("pre.txt"));
    assert.ok(audit.inScopePaths.includes("src/a.txt"), JSON.stringify(audit));
    assert.ok(audit.outOfScopePaths.includes("pre.txt"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Git audit maps a nested workspace relative to its own root", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-git-nested-"));
  const workspace = join(root, "packages", "app");
  try {
    await git(root, ["init"]); await git(root, ["config", "user.email", "fixture@example.invalid"]); await git(root, ["config", "user.name", "Fixture"]);
    await mkdir(join(workspace, "src"), { recursive: true }); await writeFile(join(workspace, "src", "a.txt"), "one"); await writeFile(join(root, "outside.txt"), "one");
    await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture"]);
    const before = await captureGitSnapshot(workspace);
    await writeFile(join(workspace, "src", "a.txt"), "two"); await writeFile(join(root, "outside.txt"), "two");
    const audit = compareGitSnapshots(before, await captureGitSnapshot(workspace), ["src"]);
    assert.ok(audit.inScopePaths.includes("src/a.txt"), JSON.stringify(audit));
    assert.ok(audit.outOfScopePaths.includes("../../outside.txt"));
    assert.equal(audit.requiresHumanReview, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Git audit is fail-closed for no-Git and records unborn repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-no-git-"));
  try {
    const none = await captureGitSnapshot(root);
    assert.equal(compareGitSnapshots(none, none, ["src"]).requiresHumanReview, true);
    await git(root, ["init"]); const unborn = await captureGitSnapshot(root);
    assert.equal(unborn.isGit, true); assert.equal(unborn.headState, "unborn");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Git audit derives bare file and directory kinds from the baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-git-kinds-"));
  try {
    await git(root, ["init"]); await git(root, ["config", "user.email", "fixture@example.invalid"]); await git(root, ["config", "user.name", "Fixture"]);
    await mkdir(join(root, ".github")); await writeFile(join(root, ".github", "workflow.yml"), "one"); await writeFile(join(root, "LICENSE"), "one");
    await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture"]);
    const before = await captureGitSnapshot(root);
    await writeFile(join(root, ".github", "new.yml"), "two");
    let audit = compareGitSnapshots(before, await captureGitSnapshot(root), [".github"]);
    assert.ok(audit.inScopePaths.includes(".github/new.yml"));
    await rm(join(root, "LICENSE")); await mkdir(join(root, "LICENSE")); await writeFile(join(root, "LICENSE", "child.txt"), "replacement");
    audit = compareGitSnapshots(before, await captureGitSnapshot(root), ["LICENSE"]);
    assert.ok(audit.inScopePaths.includes("LICENSE")); assert.ok(audit.outOfScopePaths.includes("LICENSE/child.txt"));
    await mkdir(join(root, "missing")); await writeFile(join(root, "missing", "child.txt"), "declared glob");
    audit = compareGitSnapshots(before, await captureGitSnapshot(root), ["missing/**/*"]);
    assert.ok(audit.inScopePaths.includes("missing/child.txt"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
