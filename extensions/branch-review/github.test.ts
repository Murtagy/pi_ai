import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { inspectPr } from "./github.ts";
import { runProcess } from "./process.ts";

const signal = () => AbortSignal.timeout(10000);

test("PR inspection uses read-only gh queries, pinned source, and pagination without a local repository", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "review-pr-test-"));
  const oldPath = process.env.PATH;
  t.after(async () => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  });
  const executable = join(dir, "gh");
  const argsPath = join(dir, "args.json");
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args));
if (args[1] === 'view') console.log(JSON.stringify({title:'PR fixture', headRefOid:'${"a".repeat(40)}'}));
else console.log('first line\\nsecond line\\nthird line');
`);
  await chmod(executable, 0o700);
  process.env.PATH = `${dir}:${oldPath}`;
  const view = await inspectPr(dir, { action: "view", pr: "10490", repo: "owner/repo" }, signal());
  assert.match(view, /PR fixture/);
  let args = JSON.parse(await readFile(argsPath, "utf8"));
  assert.deepEqual(args.slice(0, 3), ["pr", "view", "10490"]);
  assert.deepEqual(args.slice(-2), ["--repo", "owner/repo"]);
  const diff = await inspectPr(dir, { action: "diff", pr: "https://github.com/owner/repo/pull/10490", offset: 2, limit: 1 }, signal());
  assert.match(diff, /Lines 2-2 of 3/);
  assert.match(diff, /2: second line/);
  args = JSON.parse(await readFile(argsPath, "utf8"));
  assert.deepEqual(args, ["pr", "diff", "https://github.com/owner/repo/pull/10490", "--color", "never"]);
  await inspectPr(dir, { action: "file", repo: "fork/repo", ref: "a".repeat(40), path: "src/a b.ts" }, signal());
  args = JSON.parse(await readFile(argsPath, "utf8"));
  assert.deepEqual(args.slice(0, 5), ["api", "--method", "GET", "--hostname", "github.com"]);
  assert.equal(args.at(-1), `repos/fork/repo/contents/src/a%20b.ts?ref=${"a".repeat(40)}`);
  const cli = fileURLToPath(new URL("./inspect-cli.ts", import.meta.url));
  const output = await runProcess({ command: process.execPath, args: [cli, "pr", JSON.stringify({ action: "view", pr: "10490", repo: "owner/repo" })], cwd: dir, signal: signal() });
  assert.match(output, /PR fixture/);
  await assert.rejects(runProcess({ command: process.execPath, args: [cli, "pr", JSON.stringify({ action: "comment", pr: "10490" })], cwd: dir, signal: signal() }), /Unsupported PR inspection/);
});

test("PR inspection rejects flags, untrusted hosts, and unpinned/traversing source requests", async () => {
  for (const request of [
    { action: "view" as const, pr: "--help" },
    { action: "diff" as const, pr: "https://evil.invalid/o/r/pull/1" },
    { action: "view" as const, pr: "1", repo: "--help" },
    { action: "file" as const, repo: "o/r", ref: "main", path: "file.ts" },
    { action: "file" as const, repo: "o/r", ref: "a".repeat(40), path: "../file.ts" },
  ]) await assert.rejects(inspectPr(tmpdir(), request, signal()));
});
