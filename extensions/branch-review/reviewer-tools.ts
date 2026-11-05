import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectGit } from "./git.ts";
import { inspectPr } from "./github.ts";

// Loaded explicitly by the reviewer child, never by the parent extension.
export default function reviewerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "review_git",
    label: "Read-only Git inspection",
    description: "Inspect any local repository/worktree using cwd, without changing checkout. status includes untracked files; working_diff reads staged or unstaged changes (read untracked contents with read). remotes identifies repository context. For committed comparisons, resolve target/base to SHAs first. " +
      "diff compares merge-base(base, ref) to ref. file reads the actual committed file at ref, not the working tree. " +
      "tree lists committed file paths. refs lists local/remote-tracking refs; query filters names. log lists up to 80 commits. " +
      "Output is line-numbered and paginated: read all relevant pages. No shell, fetch, checkout, writes, or tests.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    parameters: Type.Object({
      action: StringEnum(["refs", "resolve", "diff", "file", "tree", "log", "status", "working_diff", "remotes"] as const),
      cwd: Type.Optional(Type.String({ description: "Repository/worktree directory; absolute, ~/path, or relative to starting directory" })),
      staged: Type.Optional(Type.Boolean({ description: "working_diff: true for index changes; false for unstaged changes" })),
      ref: Type.Optional(Type.String({ description: "Target ref or pinned SHA; defaults to HEAD in the selected repository" })),
      base: Type.Optional(Type.String({ description: "Base ref/SHA; required for diff, optional for resolve/log" })),
      path: Type.Optional(Type.String({ description: "Repository-relative path; required for file, optional filter for diff/tree" })),
      query: Type.Optional(Type.String({ description: "Substring filter for refs" })),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
    }),
    async execute(_id, request, signal, _onUpdate, ctx) {
      const deadline = AbortSignal.timeout(30000);
      const text = await inspectGit(ctx.cwd, request, signal ? AbortSignal.any([signal, deadline]) : deadline);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  pi.registerTool({
    name: "review_pr",
    label: "Read-only GitHub PR inspection",
    description: "Read PR metadata (view), diff, or committed source (file) through gh. Use repo owner/name or a full PR URL when not in the target repository. file requires repo, full commit SHA, and path; use head repository for fork PRs. Read all relevant pages. PR endpoints are live: compare head SHAs before/after review. GitHub may limit large PR diffs/files; report missing context. No checkout, fetch, comments, or writes.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    parameters: Type.Object({
      action: StringEnum(["view", "diff", "file"] as const),
      pr: Type.Optional(Type.String({ description: "PR number or https://github.com/owner/repo/pull/number" })),
      repo: Type.Optional(Type.String({ description: "owner/repository; required for file" })),
      cwd: Type.Optional(Type.String({ description: "Local repository context for gh; defaults to starting directory" })),
      ref: Type.Optional(Type.String({ description: "file: full commit SHA" })),
      path: Type.Optional(Type.String({ description: "file: repository-relative source path" })),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
    }),
    async execute(_id, request, signal, _onUpdate, ctx) {
      const deadline = AbortSignal.timeout(30000);
      const text = await inspectPr(ctx.cwd, request, signal ? AbortSignal.any([signal, deadline]) : deadline);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}
