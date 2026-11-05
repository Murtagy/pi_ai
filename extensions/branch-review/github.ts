import { homedir } from "node:os";
import { resolve } from "node:path";
import { paginate } from "./git.ts";
import { runProcess } from "./process.ts";

export interface PrInspection {
  action: "view" | "diff" | "file";
  pr?: string;
  repo?: string;
  cwd?: string;
  ref?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

// No arbitrary gh arguments, API methods, hosts, or shell commands.
export async function inspectPr(cwd: string, request: PrInspection, signal: AbortSignal): Promise<string> {
  const repo = request.repo;
  if (repo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("repo must be owner/repository");
  }
  let args: string[];
  if (request.action === "file") {
    if (!repo || !request.ref || !/^[a-fA-F0-9]{40}$/.test(request.ref) || !request.path) {
      throw new Error("file requires repo, a full commit SHA in ref, and a repository-relative path");
    }
    const segments = request.path.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === "..")) throw new Error("Invalid source path");
    args = ["api", "--method", "GET", "--hostname", "github.com", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${repo}/contents/${segments.map(encodeURIComponent).join("/")}?ref=${request.ref}`];
  } else {
    if (!request.pr || !/^(?:[1-9][0-9]*|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*)$/.test(request.pr)) {
      throw new Error("pr must be a positive number or a github.com pull request URL");
    }
    if (request.action === "view") {
      args = ["pr", "view", request.pr, "--json", "url,title,body,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,files"];
    } else if (request.action === "diff") args = ["pr", "diff", request.pr, "--color", "never"];
    else throw new Error("Unsupported PR inspection action");
    if (repo) args.push("--repo", repo);
  }
  const directory = request.cwd?.startsWith("~/") ? resolve(homedir(), request.cwd.slice(2)) : resolve(cwd, request.cwd ?? ".");
  let output = await runProcess({ command: "gh", args, cwd: directory, signal, inheritProcessGroup: true });
  if (request.action === "view") output = JSON.stringify(JSON.parse(output), null, 2);
  return paginate(output, request.offset, request.limit);
}
