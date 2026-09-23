import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Node compatibility matrix covers maintained lines on Windows and Linux", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(ci, /node: \[22, 24, 26\]/);
  assert.match(ci, /check-latest: true/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /smoke-release-packages\.py --expected-node \$\{\{ matrix\.node \}\}/);
  assert.match(ci, /needs: build-and-test/);
});

test("Package and release builds share the explicit Node 24 LTS version file", async () => {
  assert.equal((await readFile(".node-version", "utf8")).trim(), "24");
  for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /node-version-file: \.node-version/);
    assert.doesNotMatch(workflow, /node-version: (18|22)(?:\r?\n|$)/);
  }
  const release = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(release, /smoke-release-packages\.py --expected-node 24/);
});

test("Root and lockfile agree on the maintained minimum without upgrading dependencies", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(root.engines.node, ">=22");
  assert.deepEqual(root.engines, lock.packages[""].engines);
  assert.equal(root.version, lock.version);
  assert.equal(root.version, lock.packages[""].version);
  // Node 22 types intentionally remain the lowest supported API baseline.
  assert.match(root.devDependencies["@types/node"], /22/);
});
