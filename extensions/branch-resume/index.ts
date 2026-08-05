import {
  SessionManager,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionInfo,
} from '@earendil-works/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

interface BranchKey {
  repo: string;
  branch: string;
}

interface BranchSession extends BranchKey {
  session: string;
  updatedAt: string;
}

type BranchIndex = Record<string, BranchSession[]>;

interface CandidatePage {
  entries: BranchSession[];
  hasNext: boolean;
  hasPrevious: boolean;
}

const INDEX_PATH = join(getAgentDir(), 'branch-sessions.json');
const CUSTOM_TYPE = 'github-branch';
const MAX_RESUME_BRANCH_OPTIONS = 10;

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeGithubRepo(remoteUrl: string): string | undefined {
  const match = remoteUrl.match(/github\.com[:/]([^\s]+?)(?:\.git)?$/);
  return match?.[1];
}

function currentBranchKey(cwd: string): BranchKey | undefined {
  const branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remoteUrl = runGit(cwd, ['config', '--get', 'remote.origin.url']);
  if (!branch || !remoteUrl || branch === 'HEAD') return undefined;

  const repo = normalizeGithubRepo(remoteUrl);
  if (!repo) return undefined;

  return { repo, branch };
}

function keyString(key: BranchKey): string {
  return `github.com/${key.repo}#${key.branch}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function branchSessionFromUnknown(
  value: unknown,
  legacyKey: string,
): BranchSession | undefined {
  if (typeof value === 'string') {
    const [repo, branch = ''] = legacyKey.replace(/^github\.com\//, '').split('#');
    if (!repo) return undefined;
    return {
      repo,
      branch,
      session: value,
      updatedAt: new Date(0).toISOString(),
    };
  }

  if (!isRecord(value)) return undefined;
  const { repo, branch, session, updatedAt } = value;
  if (typeof repo !== 'string' || typeof branch !== 'string' || typeof session !== 'string') {
    return undefined;
  }

  return {
    repo,
    branch,
    session,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(0).toISOString(),
  };
}

function readIndex(): BranchIndex {
  if (!existsSync(INDEX_PATH)) return {};

  const raw: unknown = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  if (!isRecord(raw)) return {};

  const result: BranchIndex = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;

    const entries = value
      .map((item) => branchSessionFromUnknown(item, key))
      .filter((item): item is BranchSession => item !== undefined);
    if (entries.length > 0) result[key] = entries;
  }

  return result;
}

function writeIndex(index: BranchIndex): void {
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function sessionModifiedTime(session: string): number {
  try {
    return statSync(session).mtimeMs;
  } catch {
    return 0;
  }
}

function rememberSession(key: BranchKey, session: string): void {
  const index = readIndex();
  const fullKey = keyString(key);
  const entriesWithoutSession = Object.entries(index).reduce<BranchIndex>(
    (acc, [entryKey, entries]) => {
      const kept = entries.filter(
        (entry) => entry.session !== session && existsSync(entry.session),
      );
      if (kept.length > 0) acc[entryKey] = kept;
      return acc;
    },
    {},
  );
  const existing = entriesWithoutSession[fullKey] ?? [];
  const next = [
    ...existing,
    {
      repo: key.repo,
      branch: key.branch,
      session,
      updatedAt: new Date().toISOString(),
    },
  ].sort(
    (left, right) => sessionModifiedTime(right.session) - sessionModifiedTime(left.session),
  );

  writeIndex({
    ...entriesWithoutSession,
    [fullKey]: next,
  });
}

function displayPrompt(firstMessage: string, name: string | undefined): string {
  const prompt = name || firstMessage || 'empty session';
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function labelForCandidate(
  entry: BranchSession,
  infoByPath: ReadonlyMap<string, SessionInfo>,
): string {
  const info = infoByPath.get(entry.session);
  const prompt = displayPrompt(info?.firstMessage ?? '', info?.name);
  return `(${entry.branch}) - ${prompt} [${basename(entry.session)}]`;
}

function getCandidatePage(candidates: BranchSession[], start: number): CandidatePage {
  const hasPrevious = start > 0;
  const maxCountWithoutNext = MAX_RESUME_BRANCH_OPTIONS - (hasPrevious ? 1 : 0);
  const hasNext = start + maxCountWithoutNext < candidates.length;
  const candidateCount =
    MAX_RESUME_BRANCH_OPTIONS - (hasPrevious ? 1 : 0) - (hasNext ? 1 : 0);

  return {
    entries: candidates.slice(start, start + candidateCount),
    hasNext,
    hasPrevious,
  };
}

async function selectCandidate(
  candidates: BranchSession[],
  infoByPath: ReadonlyMap<string, SessionInfo>,
  ctx: ExtensionCommandContext,
): Promise<BranchSession | undefined> {
  const previousLabel = '← Previous sessions';
  const pageStarts = [0];
  let pageIndex = 0;

  while (true) {
    const start = pageStarts[pageIndex] ?? 0;
    const page = getCandidatePage(candidates, start);
    const nextStart = start + page.entries.length;
    const nextLabel = `→ More sessions (${nextStart + 1}-${Math.min(
      nextStart + MAX_RESUME_BRANCH_OPTIONS,
      candidates.length,
    )} of ${candidates.length})`;
    const labels = [
      ...(page.hasPrevious ? [previousLabel] : []),
      ...page.entries.map((entry) => labelForCandidate(entry, infoByPath)),
      ...(page.hasNext ? [nextLabel] : []),
    ];

    const choice = await ctx.ui.select('Resume branch session', labels);
    if (!choice) return undefined;

    if (choice === previousLabel) {
      pageIndex = Math.max(0, pageIndex - 1);
      continue;
    }

    if (choice === nextLabel) {
      if (pageStarts[pageIndex + 1] === undefined) pageStarts.push(nextStart);
      pageIndex += 1;
      continue;
    }

    const selectedIndex = labels.indexOf(choice) - (page.hasPrevious ? 1 : 0);
    return page.entries[selectedIndex];
  }
}

function rememberCurrentBranchSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  lastKeyString: string | undefined,
): string | undefined {
  const key = currentBranchKey(ctx.cwd);
  const session = ctx.sessionManager.getSessionFile();
  if (!key || !session) return lastKeyString;

  const nextKeyString = keyString(key);
  if (nextKeyString === lastKeyString) return lastKeyString;

  rememberSession(key, session);
  pi.appendEntry(CUSTOM_TYPE, {
    repo: key.repo,
    branch: key.branch,
    key: nextKeyString,
    session,
    timestamp: new Date().toISOString(),
  });
  ctx.ui.setStatus('branch-session', `${key.repo}#${key.branch}`);

  if (lastKeyString) {
    ctx.ui.notify(`Branch session updated: ${nextKeyString}`, 'info');
  }

  return nextKeyString;
}

export default function branchResume(pi: ExtensionAPI): void {
  let lastKeyString: string | undefined;

  pi.on('session_start', async (_event, ctx) => {
    lastKeyString = rememberCurrentBranchSession(pi, ctx, undefined);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.toolName !== 'bash') return;
    lastKeyString = rememberCurrentBranchSession(pi, ctx, lastKeyString);
  });

  pi.on('turn_end', async (_event, ctx) => {
    lastKeyString = rememberCurrentBranchSession(pi, ctx, lastKeyString);
  });

  pi.registerCommand('resume-branch', {
    description: 'Resume a pi session associated with a GitHub branch',
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const currentKey = currentBranchKey(ctx.cwd);
      if (!currentKey) {
        ctx.ui.notify('No GitHub repository/branch detected', 'error');
        return;
      }

      const requestedBranch = args.trim();
      const index = readIndex();
      const sessionInfo = await SessionManager.list(ctx.cwd);
      const infoByPath = new Map(sessionInfo.map((info) => [info.path, info]));
      const candidates = Object.values(index)
        .flat()
        .filter((entry) => entry.repo === currentKey.repo)
        .filter((entry) => !requestedBranch || entry.branch === requestedBranch)
        .filter((entry) => existsSync(entry.session))
        .sort(
          (left, right) =>
            sessionModifiedTime(right.session) - sessionModifiedTime(left.session),
        );

      if (candidates.length === 0) {
        const target = requestedBranch || 'any branch';
        ctx.ui.notify(`No sessions for ${currentKey.repo} ${target}`, 'info');
        return;
      }

      let selected = candidates[0];
      if (!requestedBranch || candidates.length > 1) {
        const choice = await selectCandidate(candidates, infoByPath, ctx);
        if (!choice) return;
        selected = choice;
      }

      await ctx.switchSession(selected.session, {
        withSession: async (ctx) => {
          ctx.ui.notify(`Resumed ${selected.repo}#${selected.branch}`, 'info');
        },
      });
    },
  });
}
