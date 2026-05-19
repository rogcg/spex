export {
  createPostHogMcpClient,
  closeAllPostHogMcpClients,
  MissingPostHogApiKeyError,
  InsecurePostHogEndpointError,
} from './client.js';
export {
  getErrorIssue,
  getSessionRecording,
  POSTHOG_TOOLS,
  PostHogToolError,
  queryEvents,
  type GetErrorIssueOptions,
  type GetSessionRecordingOptions,
  type QueryEventsOptions,
} from './operations.js';
export {
  buildPostHogBugSource,
  type BuildPostHogBugSourceOptions,
  type PostHogBugSource,
} from './bug-source.js';
export {
  POSTHOG_ISSUE_SEVERITIES,
  type AutoFixDecision,
  type AutoFixFilterConfig,
  decideAutoFix,
  InvalidPostHogWebhookPayloadError,
  parsePostHogWebhookPayload,
  type PostHogIssueSeverity,
  type PostHogWebhookEvent,
  verifyPostHogWebhookSignature,
} from './webhook.js';
export type {
  CreatePostHogMcpClientOptions,
  PostHogErrorIssue,
  PostHogErrorIssueStatus,
  PostHogErrorStackFrame,
  PostHogEvent,
  PostHogMcpClient,
  PostHogMcpClientCacheKey,
  PostHogSessionRecording,
} from './types.js';
