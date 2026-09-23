import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
export async function protectedInputSnapshot(workspace, paths) {
    if (!paths.length || new Set(paths).size !== paths.length)
        throw new Error("Provide unique --protect paths for the immutable specification and acceptance files.");
    const root = await realpath(workspace);
    const entries = {};
    for (const path of paths) {
        if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes(".."))
            throw new Error("Protected inputs must be project-relative files.");
        const absolute = resolve(root, path);
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error("Protected input must be a regular file: " + path);
        const canonical = await realpath(absolute);
        const rel = relative(root, canonical);
        if (!rel || rel.startsWith("..") || isAbsolute(rel))
            throw new Error("Protected input escaped the workspace.");
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(canonical))
            digest.update(chunk);
        entries[path] = digest.digest("hex");
    }
    return entries;
}
