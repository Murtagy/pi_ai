import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { inspectGit } from "./git.ts";
import { inspectPr } from "./github.ts";
import { cleanEnvironment, runProcess } from "./process.ts";
import { loadConfig, parseConfig, parseReviewArgs, PiReviewOutput, runReview, type ReviewConfig } from "./review.ts";

const signal = (): AbortSignal => AbortSignal.timeout(20000);

async function repository(t: TestContext): Promise<{ root: string; agentDir: string; head: string; base: string; current: string }> {
  const dir = await mkdtemp(join(tmpdir(), "branch-review-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "repo");
  const agentDir = join(dir, "agent");
  await mkdir(root);
  const git = (...args: string[]): string => execFileSync("git", args, {
    cwd: root, encoding: "utf8", env: cleanEnvironment(), stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Review test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  await writeFile(join(root, "source.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "base fixture");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-b", "feature");
  await writeFile(join(root, "source.txt"), "committed feature\n");
  git("commit", "-am", "feature fixture");
  const head = git("rev-parse", "HEAD");
  git("checkout", "main");
  await writeFile(join(root, "base-only.txt"), "must not appear in feature review\n");
  git("add", ".");
  git("commit", "-m", "main moved independently");
  const current = git("rev-parse", "HEAD");
  await writeFile(join(root, "source.txt"), "dirty caller\n");
  await writeFile(join(root, "untracked.txt"), "private caller scratch\n");
  return { root, agentDir, head, base, current };
}

function external(script: string): ReviewConfig {
  return parseConfig({ harness: "external", model: "test-model", command: [process.execPath, "-e", script], timeoutSeconds: 10 });
}

const readerScript = `
const fs = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => prompt += text);
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    prompt, source: fs.readFileSync('source.txt', 'utf8'),
    untracked: fs.existsSync('untracked.txt'),
    cwd: process.cwd(), parentSession: process.env.PI_SESSION_FILE ?? null,
    head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
  }));
});`;

test("slash command takes instructions verbatim, not positional branch or flags", () => {
  const instructions = "Review feature against main. Focus on locks; $(touch nope)\nDo not edit.";
  assert.deepEqual(parseReviewArgs(instructions), { instructions });
  assert.deepEqual(parseReviewArgs("--base is an option being reviewed"), { instructions: "--base is an option being reviewed" });
  assert.match(parseReviewArgs("").instructions, /current working directory/);
});

test("review configuration requires independent model and bounded runtime", () => {
  assert.throws(() => parseConfig({}), /Choose reviewer/);
  assert.throws(() => parseConfig({ model: "sonnet" }), /include provider/);
  assert.throws(() => parseConfig({ model: "anthropic/claude", timeoutSeconds: Infinity }), /timeoutSeconds/);
  assert.throws(() => parseConfig({ model: "x", harness: "external" }), /requires command/);
  assert.equal(parseConfig({ model: "anthropic/claude" }).timeoutSeconds, 900);
});

test("model overrides preserve default base and do not cross harnesses silently", async (t) => {
  const { agentDir } = await repository(t);
  await mkdir(agentDir);
  await writeFile(join(agentDir, "review.json"), JSON.stringify({ harness: "pi", model: "anthropic/claude", base: "main", timeoutSeconds: 73 }));
  await assert.rejects(loadConfig(agentDir, { harness: "codex" }), /requires an explicit model/);
  const config = await loadConfig(agentDir, { harness: "codex", model: "gpt-test" });
  assert.equal(config.model, "gpt-test");
  assert.equal(config.base, "main");
  assert.equal(config.timeoutSeconds, 73);
  assert.equal((await loadConfig(agentDir, {})).model, "anthropic/claude");
});

function assistant(output: PiReviewOutput, text: string, stopReason: string, extra: object = {}): void {
  output.accept(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason, ...extra } }));
}

test("Pi review cannot report intermediate text or provider errors as success", () => {
  const output = new PiReviewOutput();
  assistant(output, "Let me check", "toolUse");
  assert.throws(() => output.finish(), /did not finish/);
  assistant(output, "", "error", { errorMessage: "bad credentials" });
  assert.throws(() => output.finish(), /bad credentials/);
  assistant(output, "Truncated findings", "length");
  assert.throws(() => output.finish(), /length/);
  assistant(output, "Final findings\u2028remain intact", "stop", { usage: { input: 12, output: 3, cost: { total: 0.1 } } });
  assert.equal(output.finish(), "Final findings\u2028remain intact");
  assert.equal(output.usage.input, 12);
  assert.equal(output.usage.cost.total, 0.1);
  assert.throws(() => output.accept("not JSON"));
});

test("free instructions reach reviewer with live dirty and untracked files, without changing checkout", async (t) => {
  const { root, agentDir, current } = await repository(t);
  const instructions = "Review feature against main. Check invariants.";
  const result = await runReview({ cwd: root, agentDir, request: { instructions }, config: external(readerScript), signal: signal() });
  const evidence = JSON.parse(result.report);
  assert.equal(result.cwd, root);
  assert.equal(evidence.head, current);
  assert.equal(evidence.source, "dirty caller\n");
  assert.equal(evidence.untracked, true);
  assert.equal(evidence.parentSession, null);
  assert.ok(evidence.prompt.includes(instructions));
  assert.match(evidence.prompt, /current checkout may not match/);
  assert.match(evidence.prompt, /Read-only review/);
  assert.doesNotMatch(evidence.prompt, /Review only committed changes/);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "dirty caller\n");
  assert.equal(await readFile(join(root, "untracked.txt"), "utf8"), "private caller scratch\n");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), "main");
  const report = await readFile(join(result.artifactDir, "result.txt"), "utf8");
  assert.match(report, /Starting directory:/);
  assert.match(report, /Actual reviewed scope/);
  assert.equal(await readFile(join(evidence.cwd, "source.txt"), "utf8"), "dirty caller\n");
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
});

test("reviewer can inspect another branch's merge-base diff and committed files without checkout", async (t) => {
  const { root, head, base } = await repository(t);
  const scope = await inspectGit(root, { action: "resolve", ref: "feature", base: "main" }, signal());
  assert.ok(scope.includes(head));
  assert.ok(scope.includes(base));
  const diff = await inspectGit(root, { action: "diff", ref: head, base: "main" }, signal());
  assert.match(diff, /\+committed feature/);
  assert.doesNotMatch(diff, /base-only|dirty caller|private caller/);
  const file = await inspectGit(root, { action: "file", ref: head, path: "source.txt" }, signal());
  assert.match(file, /1: committed feature/);
  assert.match(await inspectGit(root, { action: "refs", query: "feature" }, signal()), /refs\/heads\/feature/);
  assert.doesNotMatch(await inspectGit(root, { action: "tree", ref: head }, signal()), /base-only|untracked/);
  assert.match(await inspectGit(root, { action: "log", ref: head, base }, signal()), /feature fixture/);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "dirty caller\n");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), "main");
});

test("Git inspection reads staged, unstaged, and untracked state in another worktree without writes", async (t) => {
  const { root } = await repository(t);
  const other = join(root, "..", "other");
  execFileSync("git", ["worktree", "add", other, "feature"], { cwd: root, stdio: "pipe" });
  await writeFile(join(other, "source.txt"), "staged feature\n");
  execFileSync("git", ["add", "source.txt"], { cwd: other });
  await writeFile(join(other, "source.txt"), "unstaged feature\n");
  await writeFile(join(other, "new.txt"), "new source\n");
  const status = await inspectGit(root, { action: "status", cwd: other }, signal());
  assert.match(status, /MM source.txt/);
  assert.match(status, /\?\? new.txt/);
  const staged = await inspectGit(root, { action: "working_diff", cwd: other, staged: true }, signal());
  const unstaged = await inspectGit(root, { action: "working_diff", cwd: other }, signal());
  assert.match(staged, /\+staged feature/);
  assert.match(unstaged, /\+unstaged feature/);
  assert.equal(await inspectGit(root, { action: "status", cwd: other }, signal()), status);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "dirty caller\n");
});

test("Git inspection disables configured filesystem monitors and clean filters", async (t) => {
  const { root } = await repository(t);
  const marker = join(root, "executed");
  const hook = join(root, "unsafe-hook");
  await writeFile(hook, `#!/bin/sh\nprintf unsafe >> '${marker}'\ncat\n`);
  await chmod(hook, 0o700);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("config", "core.fsmonitor", hook);
  git("config", "filter.unsafe.clean", hook);
  git("config", "filter.unsafe.required", "true");
  await writeFile(join(root, ".gitattributes"), "source.txt filter=unsafe\n");
  assert.match(await inspectGit(root, { action: "status" }, signal()), /source.txt/);
  assert.match(await inspectGit(root, { action: "working_diff" }, signal()), /dirty caller/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["config", "core.fsmonitor"], { cwd: root, encoding: "utf8" }).trim(), hook);
  const bare = join(root, "planted");
  git("init", "--bare", bare);
  await assert.rejects(inspectGit(root, { action: "status", cwd: bare }, signal()), /bare repository|safe.bareRepository/);
});

test("Git inspection fails closed for filter names that cannot be overridden safely", async (t) => {
  const { root } = await repository(t);
  execFileSync("git", ["config", "filter.a=b.clean", "false"], { cwd: root });
  await assert.rejects(inspectGit(root, { action: "status" }, signal()), /Cannot safely disable Git filter/);
});

test("Git log does not invoke a configured signature verification program", async (t) => {
  const { root } = await repository(t);
  const marker = join(root, "signature-executed");
  const verifier = join(root, "unsafe-gpg");
  await writeFile(verifier, `#!/bin/sh\nprintf unsafe >> '${marker}'\nexit 1\n`);
  await chmod(verifier, 0o700);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("config", "log.showSignature", "true");
  git("config", "gpg.program", verifier);
  const commit = `tree ${git("rev-parse", "HEAD^{tree}")}\nauthor Test <test@example.invalid> 1700000000 +0000\ncommitter Test <test@example.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n -----END PGP SIGNATURE-----\n\nsigned fixture\n`;
  const ref = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: root, input: commit, encoding: "utf8" }).trim();
  assert.match(await inspectGit(root, { action: "log", ref }, signal()), /signed fixture/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("working-tree inspection does not enter submodules with their own filters", async (t) => {
  const { root } = await repository(t);
  execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", root, "nested"], { cwd: root, stdio: "pipe" });
  const nested = join(root, "nested");
  const marker = join(root, "submodule-executed");
  const hook = join(root, "unsafe-filter");
  await writeFile(hook, `#!/bin/sh\nprintf unsafe >> '${marker}'\ncat\n`);
  await chmod(hook, 0o700);
  execFileSync("git", ["config", "filter.nested.clean", hook], { cwd: nested });
  await writeFile(join(nested, ".gitattributes"), "source.txt filter=nested\n");
  await writeFile(join(nested, "source.txt"), "dirty nested source\n");
  for (const action of ["status", "working_diff"] as const) {
    assert.match(await inspectGit(root, { action }, signal()), /Submodules excluded/);
  }
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.match(await inspectGit(root, { action: "working_diff", cwd: nested }, signal()), /dirty nested source/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("Git inspection pagination identifies omitted lines and rejects flag-shaped refs", async (t) => {
  const { root } = await repository(t);
  const first = await inspectGit(root, { action: "tree", limit: 1 }, signal());
  const next = await inspectGit(root, { action: "tree", offset: 2, limit: 1 }, signal());
  assert.match(first, /Lines 1-1 of 2/);
  assert.match(next, /2: source.txt/);
  await assert.rejects(inspectGit(root, { action: "resolve", ref: "--help" }, signal()), /Invalid Git ref/);
  await assert.rejects(inspectGit(root, { action: "file", ref: "HEAD" }, signal()), /requires.*path/);
  await assert.rejects(inspectGit(root, { action: "tree", offset: 0 }, signal()), /offset/);
  await assert.rejects(inspectGit(root, { action: "resolve", ref: "missing-branch" }, signal()), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(root));
    assert.match(error.message, /Cannot resolve ref "missing-branch"/);
    assert.match(error.message, /No fetch/);
    return true;
  });
});

test("missing inferred default base does not prevent an explicit instructions-based review", async (t) => {
  const { root, agentDir } = await repository(t);
  execFileSync("git", ["branch", "-m", "main", "trunk"], { cwd: root });
  const result = await runReview({ cwd: root, agentDir, request: { instructions: "Review feature against trunk" }, config: external(readerScript), signal: signal() });
  assert.ok(JSON.parse(result.report).prompt.includes("Review feature against trunk"));
});

test("review failure retains diagnostics without changing Git registrations", async (t) => {
  const { root, agentDir } = await repository(t);
  await assert.rejects(runReview({ cwd: root, agentDir, request: {},
    config: external('console.error("upstream unavailable"); process.exit(4)'), signal: signal() }), /upstream unavailable/);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
  const artifacts = await readdir(join(agentDir, "reviews"));
  const diagnostic = await readFile(join(agentDir, "reviews", artifacts[0], "error.txt"), "utf8");
  assert.match(diagnostic, /upstream unavailable/);
  assert.ok(!diagnostic.startsWith("Error:"));
});

test("timeout terminates reviewer without changing worktrees", async (t) => {
  const { root, agentDir } = await repository(t);
  const config = { ...external('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), timeoutSeconds: 1 };
  await assert.rejects(runReview({ cwd: root, agentDir, request: {}, config, signal: signal() }), /cancelled|TimeoutError/);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
});

test("process cancellation handles SIGTERM resistance and does not swallow spawn failures", async () => {
  const controller = new AbortController();
  await assert.rejects(runProcess({ command: process.execPath,
    args: ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
    cwd: tmpdir(), signal: controller.signal, onLine: () => controller.abort("test cancellation") }), /test cancellation/);
  await assert.rejects(runProcess({ command: "pi-review-missing-command", args: [], cwd: tmpdir(), signal: signal() }), /ENOENT/);
  await assert.rejects(runProcess({ command: process.execPath, args: [], cwd: tmpdir(), signal: AbortSignal.abort(new Error("already cancelled")) }), /already cancelled/);
});

test("outer cancellation kills nested inspection processes in the reviewer's process group", { skip: process.platform === "win32" }, async (t) => {
  const controller = new AbortController();
  let nestedPid: number | undefined;
  t.after(() => { if (nestedPid) { try { process.kill(nestedPid, "SIGKILL"); } catch {} } });
  const moduleUrl = new URL("./process.ts", import.meta.url).href;
  const nestedCode = 'process.on("SIGTERM", () => {}); console.log(process.pid); setInterval(() => {}, 1000)';
  const outerCode = `import { runProcess } from ${JSON.stringify(moduleUrl)};
    await runProcess({ command: process.execPath, args: ['-e', ${JSON.stringify(nestedCode)}], cwd: process.cwd(), signal: new AbortController().signal, inheritProcessGroup: true, onLine: line => console.log(line) });`;
  await assert.rejects(runProcess({ command: process.execPath, args: ["--input-type=module", "-e", outerCode], cwd: tmpdir(), signal: AbortSignal.any([controller.signal, signal()]), onLine: line => {
    nestedPid = Number(line);
    controller.abort("nested cancellation");
  } }), /nested cancellation/);
  assert.ok(nestedPid);
  for (let i = 0; i < 100; i++) {
    try { process.kill(nestedPid, 0); }
    catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ESRCH"); return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("Nested inspection survived outer cancellation");
});

for (const harness of ["pi", "codex", "claude"] as const) {
  test(`${harness} adapter launches a fresh restricted reviewer and collects its final report`, async (t) => {
    const { root, agentDir } = await repository(t);
    const bin = join(agentDir, "bin");
    await mkdir(bin, { recursive: true });
    const executable = join(bin, harness);
    await writeFile(executable, `#!${process.execPath}\n
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
const harness = ${JSON.stringify(harness)};
assert.equal(args.includes('--resume'), false);
assert.equal(args.includes('--continue'), false);
assert.equal(process.env.PI_SESSION_FILE, undefined);
assert.equal(fs.readFileSync('source.txt', 'utf8'), 'dirty caller\\n');
if (harness === 'pi') {
  for (const flag of ['--no-session', '--no-extensions', '--no-mcp', '--no-approve']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls,review_git,review_pr');
  assert.ok(fs.existsSync(args[args.indexOf('--extension') + 1]));
} else if (harness === 'claude') {
  for (const flag of ['--print', '--no-session-persistence', '--safe-mode', '--strict-mcp-config']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash');
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
} else {
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
}
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => prompt += text);
process.stdin.on('end', () => {
  assert.ok(prompt.includes('User instructions define scope'));
  assert.ok(prompt.includes('Read-only review'));
  if (harness === 'claude') {
    const permissions = args[args.indexOf('--allowedTools') + 1];
    const command = permissions.slice(permissions.indexOf('Bash(') + 5, -3);
    assert.ok(prompt.includes(command + ' git|pr'), 'prompt must use the exact allowed command prefix');
  }
  if (harness === 'codex') fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Independent findings');
  else if (harness === 'claude') console.log(JSON.stringify({type:'result', is_error:false, result:'Independent findings'}));
  else console.log(JSON.stringify({type:'message_end', message:{role:'assistant', stopReason:'stop', content:[{type:'text',text:'Independent findings'}], usage:{input:4,output:2,cost:{total:0.01}}}}));
});`);
    await chmod(executable, 0o700);
    const oldPath = process.env.PATH;
    const oldSession = process.env.PI_SESSION_FILE;
    process.env.PATH = `${bin}:${oldPath}`;
    process.env.PI_SESSION_FILE = "/must/not/be/shared/session.jsonl";
    try {
      const result = await runReview({ cwd: root, agentDir, request: { instructions: "Review feature against main" },
        config: parseConfig({ harness, model: harness === "pi" ? "anthropic/test" : "test" }), signal: signal() });
      assert.equal(result.report, "Independent findings");
      if (harness === "pi") assert.equal(result.usage?.cost.total, 0.01);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldSession === undefined) delete process.env.PI_SESSION_FILE;
      else process.env.PI_SESSION_FILE = oldSession;
    }
  });
}

test("file review requires neither a Git repository nor a resolvable configured base", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "review-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "standalone.txt"), "untracked source");
  const instructions = `Review ${join(root, "standalone.txt")}; P0/P1 only.`;
  const config = { ...external(`let prompt = ''; process.stdin.on('data', text => prompt += text); process.stdin.on('end', () => console.log(prompt + require('node:fs').readFileSync('standalone.txt', 'utf8')));`), base: "missing-base" };
  const result = await runReview({ cwd: root, agentDir: join(root, "agent"), request: { instructions }, config, signal: signal() });
  assert.ok(result.report.includes(instructions));
  assert.match(result.report, /untracked source/);
  assert.doesNotMatch(result.report, /Committed changes only/);
});
