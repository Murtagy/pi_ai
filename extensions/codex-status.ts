import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';

interface AuthCandidate {
  provider: string;
  accessToken: string;
  accountId: string;
}

interface RateLimitWindow {
  used_percent?: number;
  reset_after_seconds?: number | null;
  reset_at?: number | null;
}

interface RateLimit {
  primary_window?: RateLimitWindow | null;
  secondary_window?: RateLimitWindow | null;
}

interface AdditionalRateLimit {
  metered_feature?: string | null;
  limit_name?: string | null;
  rate_limit?: RateLimit | null;
}

interface Credits {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string | number | null;
}

interface UsagePayload {
  plan_type?: string;
  rate_limit?: RateLimit | null;
  additional_rate_limits?: AdditionalRateLimit[];
  credits?: Credits | null;
  rate_limit_reached_type?: { type?: string } | null;
}

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';
const CACHE_TTL_MS = 60_000;
const STATUS_KEY = 'codex-rate-limits';
const USER_AGENT = 'pi-codex-status/1.0';
const REQUEST_TIMEOUT_MS = 15_000;

let cachedPayload: UsagePayload | undefined;
let cachedAtMs = 0;

export default function codexStatus(pi: ExtensionAPI): void {
  async function refreshStatus(
    ctx: ExtensionContext,
    force: boolean,
    notify: boolean,
  ): Promise<void> {
    if (!ctx.hasUI && !notify) return;

    try {
      const candidate = await resolveAuthCandidate(ctx);
      if (!candidate) {
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
        if (notify) ctx.ui.notify('No ChatGPT OAuth credential found.', 'warning');
        return;
      }

      const nowMs = Date.now();
      if (
        !force &&
        cachedPayload !== undefined &&
        nowMs - cachedAtMs < CACHE_TTL_MS
      ) {
        updateStatusUi(ctx, candidate.provider, cachedPayload, false);
        if (notify) ctx.ui.notify(formatDetailedOutput(cachedPayload), 'info');
        return;
      }

      const payload = await fetchRateLimitStatus(candidate, resolveBaseUrl());
      cachedPayload = payload;
      cachedAtMs = nowMs;
      updateStatusUi(ctx, candidate.provider, payload, false);
      if (notify) ctx.ui.notify(formatDetailedOutput(payload), 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateStatusUi(ctx, selectedProvider(ctx), undefined, true);
      if (notify) ctx.ui.notify(`Codex status failed: ${message}`, 'error');
    }
  }

  pi.registerCommand('codex-status', {
    description: 'Show ChatGPT/Codex usage limits and credits',
    handler: async (_args, ctx) => {
      await refreshStatus(ctx, true, true);
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    void refreshStatus(ctx, false, false);
  });

  pi.on('model_select', async (_event, ctx) => {
    void refreshStatus(ctx, false, false);
  });
}

function selectedProvider(ctx: ExtensionContext): string {
  return process.env.CODEX_STATUS_AUTH_KEY ?? ctx.model?.provider ?? 'openai-codex';
}

async function resolveAuthCandidate(
  ctx: ExtensionContext,
): Promise<AuthCandidate | undefined> {
  const forcedProvider = process.env.CODEX_STATUS_AUTH_KEY;
  const providers = forcedProvider
    ? [forcedProvider]
    : [...new Set([ctx.model?.provider, 'openai-codex'].filter(isString))];

  for (const provider of providers) {
    const result = await ctx.modelRegistry.getProviderAuth(provider);
    const accessToken = result?.auth.apiKey;
    if (!accessToken) continue;

    const accountId = extractAccountId(accessToken);
    if (!accountId) continue;

    return { provider, accessToken, accountId };
  }

  return undefined;
}

function resolveBaseUrl(): string {
  const raw =
    process.env.CODEX_STATUS_BASE_URL ??
    process.env.CHATGPT_BACKEND_BASE_URL ??
    DEFAULT_BASE_URL;
  return normalizeBaseUrl(raw);
}

function normalizeBaseUrl(value: string): string {
  let url = value.trim();
  while (url.endsWith('/')) url = url.slice(0, -1);

  if (
    (url.startsWith('https://chatgpt.com') ||
      url.startsWith('https://chat.openai.com')) &&
    !url.includes('/backend-api')
  ) {
    return `${url}/backend-api`;
  }

  return url;
}

async function fetchRateLimitStatus(
  candidate: AuthCandidate,
  baseUrl: string,
): Promise<UsagePayload> {
  const pathStyle = baseUrl.includes('/backend-api') ? 'chatgpt' : 'codex';
  const url =
    pathStyle === 'chatgpt'
      ? `${baseUrl}/wham/usage`
      : `${baseUrl}/api/codex/usage`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${candidate.accessToken}`,
      'ChatGPT-Account-Id': candidate.accountId,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  const payload: unknown = JSON.parse(body);
  if (!isUsagePayload(payload)) {
    throw new Error(`GET ${url} returned an unsupported usage payload`);
  }
  return payload;
}

function updateStatusUi(
  ctx: ExtensionContext,
  provider: string,
  payload: UsagePayload | undefined,
  failed: boolean,
): void {
  if (!ctx.hasUI) return;

  if (payload === undefined) {
    ctx.ui.setStatus(
      STATUS_KEY,
      failed ? `${provider}: unavailable` : `${provider}: no data`,
    );
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, formatSummary(provider, payload));
}

function formatSummary(provider: string, payload: UsagePayload): string {
  const plan = capitalize(payload.plan_type ?? provider);
  const primary = payload.rate_limit?.primary_window;
  const credits = formatCredits(payload.credits);
  const used = primary?.used_percent;
  const parts = [plan];

  if (used !== undefined) parts.push(`${Math.round(used)}% used`);
  if (credits !== undefined) parts.push(credits);
  parts.push('chatgpt');

  return parts.join(' · ');
}

function formatDetailedOutput(payload: UsagePayload): string {
  const lines = [`Plan: ${capitalize(payload.plan_type ?? 'unknown')}`];

  const baseLimit = payload.rate_limit;
  if (baseLimit) {
    appendLimitLines(lines, '5h limit', baseLimit.primary_window);
    appendLimitLines(lines, 'Weekly limit', baseLimit.secondary_window);
  }

  for (const extra of payload.additional_rate_limits ?? []) {
    const label = formatAdditionalLabel(extra);
    appendLimitLines(
      lines,
      buildLimitLabel(label, '5h limit'),
      extra.rate_limit?.primary_window,
    );
    appendLimitLines(
      lines,
      buildLimitLabel(label, 'Weekly limit'),
      extra.rate_limit?.secondary_window,
    );
  }

  const credits = formatCredits(payload.credits);
  if (credits !== undefined) lines.push(`Credits: ${credits}`);

  const reachedType = payload.rate_limit_reached_type?.type;
  if (reachedType) lines.push(`Reached: ${capitalize(reachedType.replaceAll('_', ' '))}`);

  return lines.join('\n');
}

function appendLimitLines(
  lines: string[],
  label: string | undefined,
  window: RateLimitWindow | null | undefined,
): void {
  if (!window) return;

  const used = clampPercent(window.used_percent ?? 0);
  const remaining = 100 - used;
  const bar = renderProgressBar(remaining);
  const reset = formatReset(window);
  const prefix = label !== undefined ? `${label}: ` : '';
  const suffix = reset !== undefined ? `, resets ${reset}` : '';
  lines.push(`${prefix}${bar} ${Math.round(used)}% used${suffix}`);
}

function formatAdditionalLabel(extra: AdditionalRateLimit): string | undefined {
  const metered = extra.metered_feature?.trim();
  const limitName = extra.limit_name?.trim();

  if (metered) {
    if (limitName && limitName !== metered) return limitName;
    return metered;
  }

  return limitName || undefined;
}

function buildLimitLabel(base: string | undefined, suffix: string): string {
  return base !== undefined ? `${base} ${suffix}` : suffix;
}

function formatCredits(credits: Credits | null | undefined): string | undefined {
  if (!credits || credits.has_credits !== true) return undefined;
  if (credits.unlimited === true) return 'Unlimited';

  const rawBalance = credits.balance;
  const balance =
    typeof rawBalance === 'number'
      ? rawBalance
      : typeof rawBalance === 'string'
        ? Number.parseFloat(rawBalance.trim())
        : Number.NaN;
  if (!Number.isFinite(balance) || balance <= 0) return undefined;

  return `${Math.round(balance)} credits`;
}

function formatReset(window: RateLimitWindow): string | undefined {
  if (window.reset_after_seconds !== undefined && window.reset_after_seconds !== null) {
    return `in ${formatDuration(window.reset_after_seconds)}`;
  }
  if (window.reset_at !== undefined && window.reset_at !== null) {
    const deltaSeconds = Math.round(window.reset_at - Date.now() / 1000);
    return `in ${formatDuration(deltaSeconds)}`;
  }
  return undefined;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function renderProgressBar(percentRemaining: number): string {
  const segments = 20;
  const filled = Math.round((clampPercent(percentRemaining) / 100) * segments);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, segments - filled))}]`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function extractAccountId(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;

  try {
    const payloadText = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(payloadText);
    if (!isRecord(payload)) return undefined;

    const auth = payload['https://api.openai.com/auth'];
    const nestedAccountId = isRecord(auth) ? auth.chatgpt_account_id : undefined;
    return firstString(
      nestedAccountId,
      payload.chatgpt_account_id,
      payload.account_id,
    );
  } catch {
    return undefined;
  }
}

function isUsagePayload(value: unknown): value is UsagePayload {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.plan_type)) return false;
  if (!isOptionalNullable(value.rate_limit, isRateLimit)) return false;
  if (
    value.additional_rate_limits !== undefined &&
    (!Array.isArray(value.additional_rate_limits) ||
      !value.additional_rate_limits.every(isAdditionalRateLimit))
  ) {
    return false;
  }
  if (!isOptionalNullable(value.credits, isCredits)) return false;
  if (!isOptionalNullable(value.rate_limit_reached_type, isReachedType)) return false;
  return true;
}

function isRateLimit(value: unknown): value is RateLimit {
  if (!isRecord(value)) return false;
  return (
    isOptionalNullable(value.primary_window, isRateLimitWindow) &&
    isOptionalNullable(value.secondary_window, isRateLimitWindow)
  );
}

function isRateLimitWindow(value: unknown): value is RateLimitWindow {
  if (!isRecord(value)) return false;
  return (
    isOptionalNumber(value.used_percent) &&
    isOptionalNullableNumber(value.reset_after_seconds) &&
    isOptionalNullableNumber(value.reset_at)
  );
}

function isAdditionalRateLimit(value: unknown): value is AdditionalRateLimit {
  if (!isRecord(value)) return false;
  return (
    isOptionalNullableString(value.metered_feature) &&
    isOptionalNullableString(value.limit_name) &&
    isOptionalNullable(value.rate_limit, isRateLimit)
  );
}

function isCredits(value: unknown): value is Credits {
  if (!isRecord(value)) return false;
  return (
    isOptionalBoolean(value.has_credits) &&
    isOptionalBoolean(value.unlimited) &&
    (value.balance === undefined ||
      value.balance === null ||
      typeof value.balance === 'string' ||
      typeof value.balance === 'number')
  );
}

function isReachedType(value: unknown): value is { type?: string } {
  return isRecord(value) && isOptionalString(value.type);
}

function isOptionalNullable<T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): value is T | null | undefined {
  return value === undefined || value === null || guard(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isOptionalNullableNumber(
  value: unknown,
): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
