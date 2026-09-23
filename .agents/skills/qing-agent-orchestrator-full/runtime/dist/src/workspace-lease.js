import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** Cooperating single-owner runs share a machine/user lease, independent of RunStore.
 * This is NOT a filesystem sandbox. Never automatically reap a crash/stale lease.
 */
export async function acquireWorkspaceLease(workspace) {
    const canonical = await realpath(workspace);
    const uid = process.getuid?.();
    const root = join(tmpdir(), "qing-owner-leases-" + (uid ?? "user"));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (uid !== undefined && rootStat.uid !== uid))
        throw new Error("Unsafe workspace lease root.");
    const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    const directory = join(root, createHash("sha256").update(key).digest("hex"));
    try {
        await mkdir(directory, { mode: 0o700 });
    }
    catch (error) {
        if (error.code === "EEXIST")
            throw new Error("WORKSPACE_BUSY: a single-owner run or unreconciled lease already exists. Confirm the old process tree stopped; do not steal its lease.");
        throw error;
    }
    const nonce = randomUUID();
    const file = join(directory, "owner.json");
    try {
        await writeFile(file, JSON.stringify({ nonce, pid: process.pid, workspace: canonical }), { flag: "wx", mode: 0o600 });
    }
    catch (error) {
        await rmdir(directory).catch(() => undefined);
        throw error;
    }
    let released = false;
    return {
        directory,
        async release() {
            if (released)
                return;
            if (JSON.parse(await readFile(file, "utf8")).nonce !== nonce)
                throw new Error("Workspace lease ownership changed; refusing to remove it.");
            await unlink(file);
            await rmdir(directory);
            released = true;
        },
    };
}
