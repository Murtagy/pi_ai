import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { runProcess } from "./process.ts";

export interface GitInspection {
  action: "refs" | "resolve" | "diff" | "file" | "tree" | "log" | "status" | "working_diff" | "remotes";
  cwd?: string;
  staged?: boolean;
  ref?: string;
  base?: string;
  path?: string;
  query?: string;
  offset?: number;
  limit?: number;
}

// Fixed commands and configuration overrides prevent inspection from invoking hooks, filters, or diff drivers.
export async function inspectGit(cwd: string, request: GitInspection, signal: AbortSignal): Promise<string> {
  cwd = resolvePath(cwd, request.cwd?.startsWith("~/") ? resolvePath(homedir(), request.cwd.slice(2)) : request.cwd ?? ".");
  const safeConfig = ["-c", "safe.bareRepository=explicit", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false", "-c", "diff.submodule=short"];
  const git = (args: string[]): Promise<string> => runProcess({ command: "git", args: ["--no-pager", "--no-optional-locks", ...safeConfig, ...args], cwd, signal, inheritProcessGroup: true });
  // Status/diff can invoke clean/process filters even with --no-ext-diff and --no-textconv.
  const keys = (await git(["config", "--includes", "--null", "--name-only", "--list"])).split("\0");
  for (const key of new Set(keys)) {
    if (/^filter\..*\.(clean|process|required)$/.test(key)) {
      if (key.includes("=")) throw new Error("Cannot safely disable Git filter with '=' in its name");
      safeConfig.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
    }
  }
  const resolve = async (ref: string): Promise<string> => {
    if (!ref.trim() || ref.startsWith("-")) throw new Error(`Invalid Git ref: ${JSON.stringify(ref)}`);
    try {
      return (await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(`Cannot resolve ref ${JSON.stringify(ref)} in ${cwd}. Check spelling or use a locally available remote-tracking ref. No fetch is performed.\n${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const offset = request.offset ?? 1;
  const limit = request.limit ?? 200;
  if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1 || limit > 2000) {
    throw new Error("offset must be positive; limit must be between 1 and 2000");
  }
  let output: string;
  if (request.action === "status") {
    output = "Submodules excluded; inspect each submodule separately with cwd.\n" + await git(["status", "--ignore-submodules=all", "--short", "--untracked-files=all", "--", ...(request.path ? [request.path] : [])]);
  } else if (request.action === "working_diff") {
    output = "Submodules excluded; inspect each submodule separately with cwd.\n" + await git(["diff", "--ignore-submodules=all", "--no-ext-diff", "--no-textconv", "--no-color", ...(request.staged ? ["--cached"] : []), "--", ...(request.path ? [request.path] : [])]);
  } else if (request.action === "remotes") {
    output = await git(["remote", "-v"]);
  } else if (request.action === "refs") {
    output = await git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes"]);
    const query = request.query;
    if (query) output = output.split("\n").filter((line) => line.includes(query)).join("\n");
  } else {
    const head = await resolve(request.ref ?? "HEAD");
    const base = request.base ? await resolve(request.base) : undefined;
    switch (request.action) {
      case "resolve": {
        const mergeBase = base ? (await git(["merge-base", "--all", base, head])).trim() : undefined;
        output = JSON.stringify({ head, base, mergeBase }, null, 2);
        break;
      }
      case "diff": {
        if (!base) throw new Error("diff requires a base ref");
        const mergeBase = (await git(["merge-base", "--all", base, head])).trim();
        if (mergeBase.includes("\n")) throw new Error("Multiple merge bases; choose an explicit base commit");
        output = await git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", mergeBase, head, "--", ...(request.path ? [request.path] : [])]);
        break;
      }
      case "file":
        if (!request.path) throw new Error("file requires a repository-relative path");
        output = await git(["cat-file", "blob", `${head}:${request.path}`]);
        break;
      case "tree":
        output = await git(["ls-tree", "-r", "--name-only", head, "--", ...(request.path ? [request.path] : [])]);
        break;
      case "log":
        output = await git(["log", "--no-show-signature", "--max-count=80", "--format=%H %s", base ? `${base}..${head}` : head, "--"]);
        break;
      default:
        throw new Error(`Unsupported Git inspection action: ${request.action}`);
    }
  }
  return paginate(output, offset, limit);
}

export function paginate(output: string, offset = 1, limit = 200): string {
  if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1 || limit > 2000) {
    throw new Error("offset must be positive; limit must be between 1 and 2000");
  }
  const lines = output.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = selected.map((line, i) => `${offset + i}: ${line}`).join("\n");
  if (numbered.length > 40000) {
    throw new Error("Selected output exceeds 40,000 characters; use a smaller limit or narrower path/query");
  }
  return `[Lines ${selected.length ? offset : 0}-${selected.length ? offset + selected.length - 1 : 0} of ${lines.length}; use offset/limit for remaining lines]\n${numbered}`;
}
