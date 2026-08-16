import { stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve } from "node:path";

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

export function workspaceCandidate(runtimeRoot: string, requestedRoot: string): string {
  return isAbsolute(requestedRoot) ? resolve(requestedRoot) : resolve(runtimeRoot, requestedRoot);
}

export async function resolveSafeWorkspace(runtimeRoot: string, requestedRoot: string): Promise<string> {
  const candidate = workspaceCandidate(runtimeRoot, requestedRoot);
  const lexicalRoot = parse(candidate).root;
  const lexicalProtectedRoots = [lexicalRoot, homedir(), process.env.WINDIR, process.env.ProgramFiles]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (lexicalProtectedRoots.some((root) => samePath(root, candidate))) {
    throw new Error("Workspace root is too broad. Choose a specific project directory.");
  }
  const resolved = await realpath(candidate);
  const details = await stat(resolved);
  if (!details.isDirectory()) throw new Error("Workspace root must be an existing directory.");

  const filesystemRoot = parse(resolved).root;
  const protectedRoots = [filesystemRoot, homedir(), process.env.WINDIR, process.env.ProgramFiles]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (protectedRoots.some((root) => samePath(root, resolved))) {
    throw new Error("Workspace root is too broad. Choose a specific project directory.");
  }
  return resolved;
}
