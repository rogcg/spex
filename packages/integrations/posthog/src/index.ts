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
