export {
  createSlackClient,
  MissingSlackBotTokenError,
  type CreateSlackClientOptions,
} from './client.js';
export {
  buildSlackInstallUrl,
  completeSlackInstall,
  exchangeSlackOAuthCode,
  SlackOAuthError,
  type BuildSlackInstallUrlOptions,
  type CompleteSlackInstallOptions,
  type ExchangeSlackOAuthCodeOptions,
} from './oauth.js';
export {
  deleteWorkspaceTokens,
  listStoredWorkspaceIds,
  loadWorkspaceTokens,
  saveWorkspaceTokens,
  SlackTokenStoreError,
  type TokenStoreOptions,
} from './token-store.js';
export {
  InvalidSlackWebhookPayloadError,
  parseSlackWebhookPayload,
  SLACK_SIGNATURE_MAX_AGE_SECONDS,
  verifySlackSignature,
  type VerifySlackSignatureOptions,
} from './webhook.js';
export {
  buildFixProposedTemplate,
  buildPrOpenedTemplate,
  buildReviewCompleteTemplate,
  buildSpecGeneratedTemplate,
  type FixProposedTemplateInput,
  type PrOpenedTemplateInput,
  type ReviewCompleteTemplateInput,
  type SpecGeneratedTemplateInput,
} from './templates/index.js';
export {
  notifyFixProposed,
  notifyPrOpened,
  notifyReviewComplete,
  notifySpecGenerated,
  postToResponseUrl,
  SlackEphemeralPostError,
  type SlackChannelMap,
  type SlackNotificationEventType,
  type SlackNotifyResult,
} from './notifications.js';
export {
  computeApprovalOutcome,
  createPendingApproval,
  DEFAULT_APPROVAL_TIMEOUT_HOURS,
  deleteApproval,
  expirePendingApprovals,
  listApprovals,
  loadApproval,
  recordDecision,
  SlackApprovalError,
  type ApprovalConfig,
  type ApprovalKind,
  type ApprovalMode,
  type ApprovalRecord,
  type ApprovalStoreOptions,
  type ApprovalWorkflowSnapshot,
  type CreateApprovalArgs,
  type DecisionEntry,
  type RecordDecisionResult,
} from './approvals.js';
export {
  checkSlashPermission,
  InvalidSlackCommandError,
  parseSpexSlashCommand,
  SPEX_SLASH_HELP_TEXT,
  type PermissionCheckResult,
  type SlashCommandPermissionConfig,
  type SpexSlackCommand,
} from './commands.js';
export type {
  SlackBlock,
  SlackBlockKitMessage,
  SlackButtonInteraction,
  SlackSlashCommand,
  SlackWebhookEvent,
  SlackWorkspaceTokens,
} from './types.js';
