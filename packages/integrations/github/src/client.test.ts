import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MissingGitHubTokenError, createGitHubClient } from './client.js';

let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env.GITHUB_TOKEN;
  // `process.env.X = undefined` coerces to the string "undefined" (truthy);
  // delete the key to actually unset.
  Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
});
afterEach(() => {
  if (originalToken === undefined) {
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  } else {
    process.env.GITHUB_TOKEN = originalToken;
  }
});

describe('createGitHubClient', () => {
  it('throws MissingGitHubTokenError when GITHUB_TOKEN is unset and no token option is supplied', () => {
    expect(() => createGitHubClient()).toThrow(MissingGitHubTokenError);
  });

  it('throws MissingGitHubTokenError when an empty token is supplied', () => {
    expect(() => createGitHubClient({ token: '' })).toThrow(MissingGitHubTokenError);
  });

  it('reads GITHUB_TOKEN from the environment by default', () => {
    process.env.GITHUB_TOKEN = 'github_pat_test_environment';
    const client = createGitHubClient();
    expect(client).toBeDefined();
    expect(typeof client.request).toBe('function');
  });

  it('honours an explicit token option (overrides env)', () => {
    process.env.GITHUB_TOKEN = 'github_pat_env';
    const client = createGitHubClient({ token: 'github_pat_explicit' });
    expect(client).toBeDefined();
  });

  it('returns a client with rest namespaces wired up', () => {
    const client = createGitHubClient({ token: 'github_pat_test' });
    // Verify the headline namespaces SPEX will use exist on the client.
    expect(typeof client.rest.pulls.create).toBe('function');
    expect(typeof client.rest.issues.create).toBe('function');
    expect(typeof client.rest.repos.get).toBe('function');
  });

  it('attaches the default user agent prefix when none is supplied', () => {
    const client = createGitHubClient({ token: 'github_pat_test' });
    // Octokit normalises the User-Agent into the request defaults; assert the
    // header starts with our spex/<version> prefix even if Octokit appends its
    // own suffix.
    const ua = (client.request.endpoint.DEFAULTS.headers as Record<string, string>)['user-agent'];
    expect(typeof ua).toBe('string');
    expect(ua).toMatch(/^spex\//);
  });

  it('honours a custom userAgent option', () => {
    const client = createGitHubClient({
      token: 'github_pat_test',
      userAgent: 'spex-tests/2.0',
    });
    const ua = (client.request.endpoint.DEFAULTS.headers as Record<string, string>)['user-agent'];
    expect(ua).toMatch(/^spex-tests\/2\.0/);
  });

  it('honours a custom baseUrl option (for GitHub Enterprise compat)', () => {
    const client = createGitHubClient({
      token: 'github_pat_test',
      baseUrl: 'https://ghe.example.com/api/v3',
    });
    expect(client.request.endpoint.DEFAULTS.baseUrl).toBe('https://ghe.example.com/api/v3');
  });

  it('defaults baseUrl to https://api.github.com', () => {
    const client = createGitHubClient({ token: 'github_pat_test' });
    expect(client.request.endpoint.DEFAULTS.baseUrl).toBe('https://api.github.com');
  });

  it('passes the retries option through to request defaults', () => {
    const client = createGitHubClient({ token: 'github_pat_test', retries: 7 });
    const defaults = client.request.endpoint.DEFAULTS as { request?: { retries?: number } };
    expect(defaults.request?.retries).toBe(7);
  });

  it('defaults retries to 3', () => {
    const client = createGitHubClient({ token: 'github_pat_test' });
    const defaults = client.request.endpoint.DEFAULTS as { request?: { retries?: number } };
    expect(defaults.request?.retries).toBe(3);
  });
});
