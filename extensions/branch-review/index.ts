import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { errorMessage, loadConfig, parseReviewArgs, REVIEW_HELP, type ReviewRequest } from "./review.ts";
import { runBatch, type BatchResult } from "./batch.ts";

export default function branchReview(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  let active: { controller: AbortController; task: Promise<BatchResult> } | undefined;
  let shuttingDown = false;
  let generation = 0;

  async function start(request: ReviewRequest, ctx: ExtensionContext, signal?: AbortSignal,
    progress?: (text: string) => void): Promise<BatchResult> {
    if (active) throw new Error("Review already running. Use /review-cancel before starting another.");
    if (shuttingDown) throw new Error("Session shutting down");
    const controller = new AbortController();
    // Reserve before configuration I/O so concurrent tools cannot both start.
    const task = runBatch({ cwd: ctx.cwd, agentDir, request,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, onProgress: progress });
    active = { controller, task };
    try { return await task; }
    finally { if (active?.task === task) active = undefined; }
  }

  pi.on("session_start", () => { shuttingDown = false; });
  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    generation++;
    if (active) {
      active.controller.abort("session shutdown");
      await active.task.catch(() => undefined);
    }
  });

  pi.registerCommand("review", {
    description: "Wait for independent reviews: /review [PR, worktree, files, or other review instructions]",
    handler: async (args, ctx) => {
      if (args.trim() === "--help") {
        ctx.ui.notify(`${REVIEW_HELP}\nConfig: ${join(agentDir, "review.json")}`, "info");
        return;
      }
      const startedIn = generation;
      try {
        const result = await start(parseReviewArgs(args), ctx, ctx.signal, (text) => ctx.ui.notify(text, "info"));
        if (!shuttingDown && generation === startedIn) pi.sendMessage({ customType: "branch-review", content: result.text,
          display: true, details: result }, { triggerTurn: false });
      } catch (error) {
        if (!shuttingDown && generation === startedIn) ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("review-cancel", {
    description: "Cancel all running reviewers in the current batch",
    handler: async (_args, ctx) => {
      if (!active) { ctx.ui.notify("No review running", "info"); return; }
      active.controller.abort("/review-cancel");
      await active.task.catch(() => undefined);
      ctx.ui.notify("Review stopped", "info");
    },
  });

  pi.registerCommand("review-config", {
    description: "Set independent reviewer: /review-config pi <provider/model> or codex <model>",
    handler: async (args, ctx) => {
      const path = join(agentDir, "review.json");
      if (!args.trim()) {
        let current = "Not configured";
        try { current = await readFile(path, "utf8"); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            ctx.ui.notify(errorMessage(error), "error"); return;
          }
        }
        ctx.ui.notify(`${current}\n\n${REVIEW_HELP}\nConfig: ${path}`, "info");
        return;
      }
      try {
        const parts = args.trim().split(/\s+/);
        if (parts.length !== 2 || !["pi", "codex"].includes(parts[0])) {
          throw new Error("Usage: /review-config pi <provider/model> | /review-config codex <model>");
        }
        // Load existing settings so changing model does not discard timeout/base/custom command.
        const config = await loadConfig(agentDir, { harness: parts[0], model: parts[1] });
        await mkdir(agentDir, { recursive: true });
        let saved: Record<string, unknown> = {};
        try { saved = JSON.parse(await readFile(path, "utf8")); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        const next = saved.reviewers && typeof saved.reviewers === "object"
          ? { ...saved, reviewers: { ...saved.reviewers, astra: config } } : config;
        await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        ctx.ui.notify(`Reviewer: ${config.harness}/${config.model}\nSaved ${path}`, "info");
      } catch (error) { ctx.ui.notify(errorMessage(error), "error"); }
    },
  });

  pi.registerTool({
    name: "request_review",
    label: "Independent review",
    description: "Request independent reviews and WAIT for findings. Free-form instructions define scope: a PR (include repository or URL when ambiguous), worktree path, specific files, branch comparison, or architecture. " +
      "Reviewers inspect live files, including uncommitted/untracked files when requested; no commit required. Avoid editing while reviews run. Missing scope/access must be reported, not silently substituted. " +
      "Both receive identical instructions with independent contexts; no caller conversation is shared. Read-only review: no edits, checkout, fetch, commits, comments, or delegation. Feedback is not authorization to make changes. " +
      "Defaults to astra and opus concurrently, with labeled reports; select one explicitly if desired (legacy harness/model overrides select one). Timeout/cancellation stops reviewer processes. One batch at a time; CLI reviewers are not OS-sandboxed. Compare reported scopes/SHAs; live files are not snapshot-isolated.",
    parameters: Type.Object({
      instructions: Type.String({ minLength: 1, description: "Free-form review task. Examples: Review PR #10490 in owner/repo, P0/P1 only; Review worktree /tmp/feature including uncommitted changes; Review /path/a.ts and /path/b.ts. Include enough repository/path context to identify scope." }),
      reviewers: Type.Optional(Type.Array(Type.String({ enum: ["astra", "opus"] }), { minItems: 1, maxItems: 2, uniqueItems: true, description: "Defaults to astra and opus concurrently. Select one explicitly for a single review." })),
      harness: Type.Optional(Type.String({ enum: ["pi", "codex", "external"], description: "Override configured harness; also supply model when switching" })),
      model: Type.Optional(Type.String({ description: "Independent reviewer model. Pi requires provider/model. Defaults to review.json, NOT current session model." })),
    }),
    async execute(_id, request, signal, onUpdate, ctx) {
      const result = await start(request, ctx, signal, (text) => onUpdate?.({
        content: [{ type: "text", text }], details: undefined,
      }));
      return { content: [{ type: "text", text: result.text }], details: result, usage: result.usage };
    },
  });
}
