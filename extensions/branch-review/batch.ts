import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, formatResult, loadConfig, parseConfig, runReview, type ReviewRequest, type ReviewResult } from "./review.ts";

export interface BatchResult {
  text: string;
  reviews: { name: string; result?: ReviewResult; error?: string }[];
  usage?: ReviewResult["usage"];
}

export async function runBatch(options: {
  cwd: string; agentDir: string; request: ReviewRequest; signal: AbortSignal;
  onProgress?: (text: string) => void;
}): Promise<BatchResult> {
  const { request, agentDir, signal } = options;
  const names = request.reviewers ?? (request.harness || request.model ? ["astra"] : ["astra", "opus"]);
  if (!names.length || new Set(names).size !== names.length || names.some(name => !["astra", "opus"].includes(name))) {
    throw new Error("reviewers must contain astra and/or opus, without duplicates");
  }
  if (request.reviewers && (request.harness || request.model)) {
    throw new Error("Use reviewers OR legacy harness/model overrides, not both");
  }
  // Read profiles once, before starting any reviewer.
  let raw: unknown = {};
  try { raw = JSON.parse(await readFile(join(agentDir, "review.json"), "utf8")); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("review.json must be an object");
  const saved = raw as Record<string, unknown>;
  const profiles = saved.reviewers;
  if (profiles !== undefined && (typeof profiles !== "object" || profiles === null || Array.isArray(profiles))) {
    throw new Error("reviewers configuration must be an object");
  }
  const configs = await Promise.all(names.map(async name => {
    const profile = (profiles as Record<string, unknown> | undefined)?.[name];
    if (profile !== undefined && !request.harness && !request.model) return parseConfig(profile);
    if (name === "opus") return parseConfig({ harness: "claude", model: "opus", base: saved.base, timeoutSeconds: saved.timeoutSeconds });
    return loadConfig(agentDir, request);
  }));
  const reviews = await Promise.all(names.map(async (name, index) => {
    const progress = (text: string) => options.onProgress?.(`[${name}] ${text}`);
    try {
      if (configs[index].harness === "claude" || configs[index].harness === "external") {
        progress("CLI permissions are not an OS read-only sandbox.");
      }
      const result = await runReview({ ...options, config: configs[index], onProgress: progress });
      progress("Finished");
      return { name, result };
    } catch (error) {
      progress(`Failed: ${errorMessage(error)}`);
      return { name, error: errorMessage(error) };
    }
  }));
  signal.throwIfAborted();
  const text = reviews.map(review => `## ${review.name}\n\n${"result" in review ? formatResult(review.result) : `FAILED: ${review.error}`}`).join("\n\n");
  if (reviews.every(review => !("result" in review))) throw new Error(text);
  let usage: BatchResult["usage"];
  for (const review of reviews) {
    const current = "result" in review ? review.result.usage : undefined;
    if (!current) continue;
    if (!usage) { usage = structuredClone(current); continue; }
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) usage[key] += current[key];
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) usage.cost[key] += current.cost[key];
  }
  return { text, reviews, usage };
}
