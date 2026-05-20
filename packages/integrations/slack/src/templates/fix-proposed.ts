import type { SlackBlockKitMessage } from '../types.js';

export interface FixProposedTemplateInput {
  /** Short title of the fix. */
  title: string;
  /** One-paragraph hypothesis the LLM converged on (mrkdwn allowed). */
  hypothesis: string;
  /** Concrete files/locations the fix would touch. */
  filesAffected: readonly string[];
  /** Origin (e.g. "PostHog issue PH-1234 (23 occurrences in 1h)"). */
  origin: string;
  /**
   * Correlation id threading the approval back to the paused workflow. Set
   * as the `value` of each action button so the receiver can resume the
   * right workflow when the user clicks.
   */
  correlationId: string;
  /** When omitted, the template renders the buttons inert (display-only). */
  approvalRequested?: boolean;
}

/**
 * Slack Block Kit template for "SPEX has a fix ready, needs human approval
 * before opening the PR." Always includes Approve / Reject / Details buttons
 * when `approvalRequested` is true.
 *
 * The `value` on each button carries the correlation id so the receiver can
 * thread the decision back to the paused workflow state in
 * `.ai/scratch/approvals/`.
 */
export function buildFixProposedTemplate(input: FixProposedTemplateInput): SlackBlockKitMessage {
  const title = input.title.length > 140 ? `${input.title.slice(0, 137)}…` : input.title;
  const fileList =
    input.filesAffected.length === 0
      ? '_(no files reported)_'
      : input.filesAffected.map((f) => `• \`${f}\``).join('\n');
  const fallback = `SPEX proposed a fix for ${input.title} — approval requested`;
  const blocks: SlackBlockKitMessage['blocks'] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🔧 SPEX fix proposed — approval requested' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${title}*` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Origin: ${input.origin}` }],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Hypothesis*\n${input.hypothesis}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Files affected*\n${fileList}` },
    },
  ];
  if (input.approvalRequested !== false) {
    blocks.push({
      type: 'actions',
      block_id: 'spex_approval_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve & Open PR' },
          style: 'primary',
          action_id: 'spex_approve',
          value: input.correlationId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject' },
          style: 'danger',
          action_id: 'spex_reject',
          value: input.correlationId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 Inspect details' },
          action_id: 'spex_inspect',
          value: input.correlationId,
        },
      ],
    });
  }
  return { text: fallback, blocks };
}
