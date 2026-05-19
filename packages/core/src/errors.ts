export class SpexError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MissingApiKeyError extends SpexError {
  readonly envVar: string;

  constructor(envVar: string) {
    super(`Missing required environment variable: ${envVar}`);
    this.envVar = envVar;
  }
}
