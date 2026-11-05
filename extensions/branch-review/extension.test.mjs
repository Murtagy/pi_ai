import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise actual Pi registration with either local peers or the installed CLI.
let piEntry;
try { piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")); }
catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  const cli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
  for (let dir = dirname(cli); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      if (manifest.name === "@earendil-works/pi-coding-agent") { piEntry = join(dir, manifest.main); break; }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!piEntry) throw new Error("Integration tests require Pi's npm package or locally installed peers");
}
const { loadExtensions } = await import(pathToFileURL(join(dirname(piEntry), "core/extensions/loader.js")).href);
const extensionDir = dirname(fileURLToPath(import.meta.url));

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), "review-command-test-"));
  const cwd = join(temp, "repo");
  const agent = join(temp, "agent");
  const ready = join(temp, "ready");
  const release = join(temp, "release");
  let extension;
  t.after(async () => {
    for (const handler of extension?.handlers.get("session_shutdown") ?? []) await handler({}, {});
    await rm(temp, { recursive: true, force: true });
  });
  await mkdir(cwd);
  await mkdir(agent);
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.name", "Review fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  await writeFile(join(cwd, "file.txt"), "base\n");
  git("add", "."); git("commit", "-m", "fixture base");
  git("checkout", "-b", "feature");
  await writeFile(join(cwd, "file.txt"), "feature\n");
  git("commit", "-am", "fixture feature");
  git("checkout", "main");
  const script = `
    const fs = require('node:fs');
    let prompt = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', text => prompt += text);
    process.stdin.on('end', () => {
      fs.writeFileSync(${JSON.stringify(ready)}, prompt);
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(release)})) {
          clearInterval(timer);
          console.log('Independent findings: P1 example');
        }
      }, 10);
    });`;
  const configPath = join(agent, "review.json");
  const config = { harness: "external", model: "fixture", base: "main", command: [process.execPath, "-e", script] };
  await writeFile(configPath, JSON.stringify({ ...config, reviewers: { opus: config } }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  let loaded;
  try {
    process.env.PI_CODING_AGENT_DIR = agent;
    loaded = await loadExtensions([join(extensionDir, "index.ts")], cwd);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
  assert.deepEqual(loaded.errors, []);
  extension = loaded.extensions[0];
  const messages = [];
  const notices = [];
  loaded.runtime.sendMessage = (message, options) => messages.push({ message, options });
  const ctx = { cwd, ui: { notify: (...args) => notices.push(args) } };
  async function waitForReviewer() {
    for (let i = 0; i < 400; i++) {
      try { return await readFile(ready, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Reviewer did not start: ${JSON.stringify(notices)}`);
  }
  return { extension, ctx, messages, notices, ready, release, waitForReviewer, configPath };
}

test("slash command remains pending until findings arrive and does not start an automatic fix turn", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const instructions = "Review feature against main. Report P0/P1 findings.";
  let completed = false;
  const pending = f.extension.commands.get("review").handler(instructions, f.ctx).then(() => { completed = true; });
  const prompt = await f.waitForReviewer();
  assert.ok(prompt.includes(instructions));
  assert.equal(completed, false);
  assert.equal(f.messages.length, 0);
  await writeFile(f.release, "continue");
  await pending;
  assert.equal(completed, true);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].message.content, /Independent findings: P1/);
  assert.equal(f.messages[0].options.triggerTurn, false);
  assert.equal(f.messages[0].options.deliverAs, undefined);
});

test("agent tool accepts instructions only and caller cannot continue until review finishes", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  let completed = false;
  const pending = f.extension.tools.get("request_review").definition.execute("test", { instructions: "Review feature against main" }, undefined, undefined, f.ctx)
    .then(result => { completed = true; return result; });
  await f.waitForReviewer();
  assert.equal(completed, false);
  await writeFile(f.release, "continue");
  const result = await pending;
  assert.match(result.content[0].text, /Independent findings/);
  assert.deepEqual(result.details.reviews.map(review => review.name), ["astra", "opus"]);
  assert.ok(result.details.reviews.every(review => review.result));
  assert.equal(f.messages.length, 0);
});

for (const selection of [{ reviewers: ["astra"] }, { reviewers: ["opus"] }, { model: "fixture" }]) {
  test(`explicit single reviewer stays single: ${JSON.stringify(selection)}`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t);
    await writeFile(f.release, "continue");
    const result = await f.extension.tools.get("request_review").definition.execute("single", {
      instructions: "Review current branch", ...selection,
    }, undefined, undefined, f.ctx);
    assert.deepEqual(result.details.reviews.map(review => review.name), selection.reviewers ?? ["astra"]);
    assert.ok(result.details.reviews[0].result);
  });
}

test("blocking slash command remains cancellable and emits no successful report on cancellation", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const pending = f.extension.commands.get("review").handler("", f.ctx);
  assert.match(await f.waitForReviewer(), /current working directory/);
  await f.extension.commands.get("review-cancel").handler("", f.ctx);
  await pending;
  assert.equal(f.messages.length, 0);
  assert.ok(f.notices.some(([text]) => text.includes("cancelled")));
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: f.ctx.cwd, encoding: "utf8" });
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
});

for (const outcome of ["success", "failure", "cancel", "default"]) {
  test(`named reviewers run concurrently with independent processes and identical instructions: ${outcome}`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t);
    const config = JSON.parse(await readFile(f.configPath, "utf8"));
    const reviewers = Object.fromEntries(["astra", "opus"].map(name => [name, {
      ...config,
      command: [process.execPath, "-e", `
        const fs = require('node:fs');
        let prompt = '';
        process.stdin.on('data', text => prompt += text);
        process.stdin.on('end', () => {
          fs.writeFileSync(${JSON.stringify(f.ready)} + '-${name}', JSON.stringify({ cwd: process.cwd(), pid: process.pid, prompt }));
          const timer = setInterval(() => {
            if (fs.existsSync(${JSON.stringify(f.release)})) {
              clearInterval(timer);
              if (${JSON.stringify(outcome)} === 'failure' && '${name}' === 'opus') process.exit(4);
              console.log('${name} findings');
            }
          }, 10);
        });`],
    }]));
    await writeFile(f.configPath, JSON.stringify({ reviewers }));
    const pending = f.extension.tools.get("request_review").definition.execute("both", {
      instructions: "Review current branch", ...(outcome === "default" ? {} : { reviewers: ["astra", "opus"] }),
    }, undefined, undefined, f.ctx);
    // Attach rejection handler immediately for cancellation.
    const settled = pending.then(result => ({ result }), error => ({ error }));
    const paths = [];
    for (const name of ["astra", "opus"]) {
      for (let i = 0; i < 400; i++) {
        try { paths.push(await readFile(`${f.ready}-${name}`, "utf8")); break; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    assert.equal(paths.length, 2, "both processes start before either is released");
    const [astra, opus] = paths.map(text => JSON.parse(text));
    assert.notEqual(astra.pid, opus.pid);
    assert.equal(astra.cwd, opus.cwd);
    assert.equal(astra.prompt, opus.prompt);
    if (outcome === "cancel") await f.extension.commands.get("review-cancel").handler("", f.ctx);
    else await writeFile(f.release, "continue");
    const completed = await settled;
    if (outcome === "cancel") assert.ok(completed.error);
    else {
      assert.match(completed.result.content[0].text, /astra findings/);
      assert.match(completed.result.content[0].text, outcome === "failure" ? /opus\n\nFAILED/ : /opus findings/);
      const results = completed.result.details.reviews.filter(review => review.result).map(review => review.result);
      assert.equal(new Set(results.map(result => result.cwd)).size, 1);
    }
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: f.ctx.cwd, encoding: "utf8" });
    assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
  });
}

test("reviewer-only extension exposes read-only committed-file inspection without delegation", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const loaded = await loadExtensions([join(extensionDir, "reviewer-tools.ts")], f.ctx.cwd);
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions[0].tools;
  assert.equal(tools.has("request_review"), false);
  assert.equal(tools.has("review_pr"), true);
  const result = await tools.get("review_git").definition.execute("inspect", { action: "file", ref: "feature", path: "file.txt" }, undefined, undefined, f.ctx);
  assert.match(result.content[0].text, /1: feature/);
  assert.equal(await readFile(join(f.ctx.cwd, "file.txt"), "utf8"), "base\n");
  await f.extension.commands.get("review-config").handler("pi anthropic/test-model", f.ctx);
  const config = JSON.parse(await readFile(f.configPath, "utf8"));
  assert.equal(config.reviewers.astra.model, "anthropic/test-model");
  assert.equal(config.reviewers.astra.base, "main");
  assert.equal(config.reviewers.opus.model, "fixture");
});
