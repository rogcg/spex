import { WebClient } from '@slack/web-api';
import { SpexError } from '@spex/core';
import { type TokenStoreOptions, saveWorkspaceTokens } from './token-store.js';
import type { SlackWorkspaceTokens } from './types.js';

const DEFAULT_BOT_SCOPES = [
  'chat:write',
  'chat:write.public',
  'commands',
  'channels:read',
  'users:read',
  'im:write',
];
const DEFAULT_USER_SCOPES: string[] = [];

export class SlackOAuthError extends SpexError {
  readonly slackError: string | undefined;
  constructor(message: string, slackError?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.slackError = slackError;
  }
}

export interface BuildSlackInstallUrlOptions {
  /** Slack app's client id (from the app's "Basic Information" page). */
  clientId: string;
  /**
   * URL Slack redirects to with `?code=...&state=...` after the user
   * approves the install. Must match a "Redirect URL" registered on the app.
   */
  redirectUri: string;
  /** Anti-CSRF token. SPEX defaults to a random hex string when omitted. */
  state: string;
  /** Bot scopes to request. Defaults to {@link DEFAULT_BOT_SCOPES}. */
  botScopes?: readonly string[];
  /** User scopes to request. Defaults to none. */
  userScopes?: readonly string[];
}

/**
 * Build the Slack OAuth v2 install URL. The user-facing CLI prints this URL
 * and asks the operator to open it; Slack redirects to `redirectUri` with a
 * single-use `code` once the install is approved.
 *
 * `state` MUST be persisted server-side by the caller and compared on the
 * callback — Slack does not validate it. SPEX defaults to a single-use hex
 * token written to `.ai/scratch/slack-oauth-state.json`.
 */
export function buildSlackInstallUrl(options: BuildSlackInstallUrlOptions): string {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('state', options.state);
  url.searchParams.set('scope', (options.botScopes ?? DEFAULT_BOT_SCOPES).join(','));
  const userScopes = options.userScopes ?? DEFAULT_USER_SCOPES;
  if (userScopes.length > 0) {
    url.searchParams.set('user_scope', userScopes.join(','));
  }
  return url.toString();
}

export interface ExchangeSlackOAuthCodeOptions {
  /** Slack app client id. */
  clientId: string;
  /** Slack app client secret. */
  clientSecret: string;
  /** Single-use `code` Slack delivered to the redirect URL. */
  code: string;
  /** Must equal the redirect URI used in the install URL. */
  redirectUri: string;
  /**
   * Optional WebClient injection — tests stub `oauthV2Access` through here.
   * In production callers normally let the function build a fresh client.
   */
  client?: WebClient;
}

interface OAuthV2Response {
  ok: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  app_id?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
}

/**
 * Exchange an OAuth v2 `code` for a bot token. Returns the `SlackWorkspaceTokens`
 * tuple ready to hand off to {@link saveWorkspaceTokens}.
 *
 * Throws {@link SlackOAuthError} on every failure path Slack reports:
 *   - `oauth_v2_access` returns `{ok: false, error: 'invalid_code'}` (most common)
 *   - the response is missing required fields
 *   - the underlying HTTP request failed
 */
export async function exchangeSlackOAuthCode(
  options: ExchangeSlackOAuthCodeOptions,
): Promise<SlackWorkspaceTokens> {
  const client = options.client ?? new WebClient();
  let response: OAuthV2Response;
  try {
    response = (await client.oauth.v2.access({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    })) as OAuthV2Response;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new SlackOAuthError(`Slack oauth.v2.access call failed: ${message}`, undefined, {
      cause,
    });
  }
  if (response.ok !== true) {
    throw new SlackOAuthError(
      `Slack OAuth exchange failed (Slack error: ${response.error ?? 'unknown'})`,
      response.error,
    );
  }
  const teamId = response.team?.id;
  const teamName = response.team?.name;
  if (
    response.access_token === undefined ||
    response.bot_user_id === undefined ||
    response.app_id === undefined ||
    teamId === undefined ||
    teamName === undefined ||
    response.scope === undefined
  ) {
    throw new SlackOAuthError(
      'Slack OAuth response was missing required fields (access_token / bot_user_id / app_id / team / scope)',
    );
  }
  return {
    team: { id: teamId, name: teamName },
    appId: response.app_id,
    accessToken: response.access_token,
    botUserId: response.bot_user_id,
    scope: response.scope,
    installedAt: new Date().toISOString(),
    ...(response.refresh_token !== undefined ? { refreshToken: response.refresh_token } : {}),
    ...(response.expires_in !== undefined ? { expiresIn: response.expires_in } : {}),
  };
}

export interface CompleteSlackInstallOptions extends ExchangeSlackOAuthCodeOptions {
  /** Project dir + storage-key config used to persist the resulting tokens. */
  storage: TokenStoreOptions;
}

/**
 * One-shot helper that performs the OAuth exchange + persists the tokens to
 * disk. Returns the saved tokens so callers can immediately use them.
 *
 * Use this from the OAuth callback handler. The caller is responsible for
 * validating the `state` parameter against the value it originally generated
 * — Slack itself does not validate state.
 */
export async function completeSlackInstall(
  options: CompleteSlackInstallOptions,
): Promise<SlackWorkspaceTokens> {
  const tokens = await exchangeSlackOAuthCode(options);
  await saveWorkspaceTokens(tokens, options.storage);
  return tokens;
}
