import { inspectGit } from "./git.ts";
import { inspectPr } from "./github.ts";

// Claude's Bash permission permits only this entry point, not arbitrary node scripts.
try {
  const [kind, json, ...extra] = process.argv.slice(2);
  if (!json || extra.length || !["git", "pr"].includes(kind)) throw new Error("Usage: inspect-cli.ts git|pr '<JSON request>'");
  const request = JSON.parse(json);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Request must be an object");
  const inspect = kind === "git" ? inspectGit : inspectPr;
  console.log(await inspect(process.cwd(), request, AbortSignal.timeout(30000)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
