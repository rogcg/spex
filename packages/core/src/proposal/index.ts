export {
  generateProposalDecisions,
  reviseDecision,
  exploreDecisionAlternatives,
  debateDecision,
  type DebateDecisionOptions,
  type ExploreAlternativesOptions,
  type GenerateProposalDecisionsOptions,
  type ReviseDecisionOptions,
} from './generator.js';
export {
  PROPOSAL_DECISIONS_SYSTEM_PROMPT,
  DECISION_REVISION_SYSTEM_PROMPT,
  DECISION_ALTERNATIVES_SYSTEM_PROMPT,
  DECISION_DEBATE_SYSTEM_PROMPT,
  buildProposalDecisionsUserPrompt,
  buildDecisionRevisionUserPrompt,
  buildDecisionAlternativesUserPrompt,
  buildDecisionDebateUserPrompt,
} from './prompts.js';
export { assembleTechSpec, type AssembleTechSpecOptions } from './assembler.js';
export {
  appendDecisionAuditEntry,
  auditLogPath,
  buildAuditEntry,
  type DecisionAuditEntry,
} from './audit.js';
export {
  ProposalPausedError,
  loadProposalState,
  saveProposalState,
} from './state.js';
export {
  runProposalApproval,
  type DecisionAction,
  type DecisionPrompter,
  type ProposalContext,
  type RunProposalApprovalOptions,
  type RunProposalApprovalResult,
} from './flow.js';
