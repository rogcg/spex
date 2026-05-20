import { WebClient, type WebClientOptions } from '@slack/web-api';
import { SpexError } from '@spex/core';
import type { SlackWorkspaceTokens } from './types.js';

const BOT_TOKEN_ENV_VAR = 'SLACK_BOT_TOKEN';
const DEFAULT_RETRIES = 3;

export class MissingSlackBotTokenError extends SpexError {
  readonly envVar: string;
  constructor(envVar: string) {
    super(
      `Missing required environment variable: ${envVar}. Either install the SPEX Slack app (which writes a token to .ai/.slack-tokens.json) or set ${envVar} to a bot token (xoxb-...).`,
    );
    this.envVar = envVar;
  }
}

export interface CreateSlackClientOptions {
  /**
   * Bot token (xoxb-...). Defaults to `process.env.SLACK_BOT_TOKEN`. Throws
   * {@link MissingSlackBotTokenError} when both are absent.
   */
  token?: string;
  /**
   * Optional pre-loaded workspace tokens object. When provided, `accessToken`
   * is used directly and `token` / env-var are ignored.
   */
  workspace?: SlackWorkspaceTokens;
  /**
   * Slack Web API retries. Defaults to 3 (per `@slack/web-api`'s built-in
   * exponential-backoff retry policy).
   */
  retries?: number;
  /**
   * Optional override for the underlying WebClient options bag. Tests pass
   * a stub `agent` or `slackApiUrl` here; production callers normally do not.
   */
  webClientOptions?: WebClientOptions;
}

/**
 * Construct an authenticated `@slack/web-api` WebClient.
 *
 * Resolution order for the token:
 *   1. `options.workspace.accessToken` (in-memory tokens, e.g. from an OAuth
 *      callback the caller just handled).
 *   2. `options.token` (explicit override).
 *   3. `process.env.SLACK_BOT_TOKEN`.
 *
 * Throws {@link MissingSlackBotTokenError} if none of the above resolve.
 */
export function createSlackClient(options: CreateSlackClientOptions = {}): WebClient {
  const token = options.workspace?.accessToken ?? options.token ?? process.env[BOT_TOKEN_ENV_VAR];
  if (token === undefined || token.length === 0) {
    throw new MissingSlackBotTokenError(BOT_TOKEN_ENV_VAR);
  }
  const retries = options.retries ?? DEFAULT_RETRIES;
  return new WebClient(token, {
    retryConfig: { retries },
    ...(options.webClientOptions ?? {}),
  });
}
