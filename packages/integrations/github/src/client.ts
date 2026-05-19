import { retry } from '@octokit/plugin-retry';
import { Octokit } from '@octokit/rest';
import { SpexError } from '@spex/core';

/**
 * Octokit subclass with the retry plugin pre-installed. SPEX uses this so
 * rate-limit responses are retried with exponential backoff transparently.
 */
const OctokitWithRetry = Octokit.plugin(retry);

const DEFAULT_RETRIES = 3;
const DEFAULT_USER_AGENT_PREFIX = 'spex/0.4.0';

export class MissingGitHubTokenError extends SpexError {
  readonly envVar: string;

  constructor(envVar: string) {
    super(
      `Missing required environment variable: ${envVar}. Generate a token at https://github.com/settings/personal-access-tokens/new and set ${envVar} before running this command.`,
    );
    this.envVar = envVar;
  }
}

export interface CreateGitHubClientOptions {
  /**
   * GitHub personal access token. Defaults to `process.env.GITHUB_TOKEN`.
   * Throws {@link MissingGitHubTokenError} when both are absent.
   */
  token?: string;
  /**
   * Override the User-Agent header. Defaults to `spex/<version>`. GitHub
   * requires every API call to carry a User-Agent or it returns 403.
   */
  userAgent?: string;
  /**
   * Override the API base URL. Defaults to `https://api.github.com`. Set this
   * to point at a GitHub Enterprise Server instance.
   */
  baseUrl?: string;
  /**
   * Number of retry attempts on transient failures (rate-limit / 5xx).
   * Defaults to 3.
   */
  retries?: number;
}

/**
 * Build an authenticated Octokit client. The returned instance is a real
 * `Octokit` with the retry plugin installed; callers can use any method on
 * `client.rest.*` directly (e.g. `client.rest.pulls.create({...})`).
 *
 * Auth: PAT only. GitHub App auth is on the roadmap but not implemented here.
 */
export function createGitHubClient(options: CreateGitHubClientOptions = {}): Octokit {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token || token.length === 0) {
    throw new MissingGitHubTokenError('GITHUB_TOKEN');
  }

  return new OctokitWithRetry({
    auth: token,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT_PREFIX,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    request: {
      retries: options.retries ?? DEFAULT_RETRIES,
    },
  });
}

/** Re-exported for callers that need the type. */
export type GitHubClient = Octokit;
