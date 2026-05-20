import type { SlackBlockKitMessage } from '../types.js';

export interface SpecGeneratedTemplateInput {
  /** Feature title from the spec. */
  title: string;
  /** Feature slug (becomes the branch name + .ai/specs/<slug>.yaml). */
  slug: string;
  /** One-line summary from the spec. */
  summary: string;
  /** Acceptance criteria, one per line. */
  acceptanceCriteria: readonly string[];
  /** Correlation id (set when approval is required). */
  correlationId?: string;
  /** When true, render Approve / Reject buttons. Default false (notify-only). */
  approvalRequested?: boolean;
}

/**
 * Slack Block Kit template posted when SPEX generates a feature spec. By
 * default this is notify-only (the human reviews in their terminal); when
 * `approvalRequested=true` it doubles as an async approval gate before the
 * implementation phase kicks off.
 */
export function buildSpecGeneratedTemplate(
  input: SpecGeneratedTemplateInput,
): SlackBlockKitMessage {
  const title = input.title.length > 140 ? `${input.title.slice(0, 137)}…` : input.title;
  const criteria =
    input.acceptanceCriteria.length === 0
      ? '_(no acceptance criteria listed)_'
      : input.acceptanceCriteria
          .slice(0, 5)
          .map((c) => `• ${c}`)
          .join('\n');
  const more =
    input.acceptanceCriteria.length > 5
      ? `\n_… and ${input.acceptanceCriteria.length - 5} more_`
      : '';
  const fallback = `SPEX generated feature spec: ${input.title}`;
  const blocks: SlackBlockKitMessage['blocks'] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: input.approvalRequested
          ? '📄 SPEX spec → approval requested'
          : '📄 SPEX spec generated',
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${title}*` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Slug: \`${input.slug}\`` }],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: input.summary },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Acceptance criteria*\n${criteria}${more}` },
    },
  ];
  if (input.approvalRequested === true && input.correlationId !== undefined) {
    blocks.push({
      type: 'actions',
      block_id: 'spex_approval_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve' },
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
      ],
    });
  }
  return { text: fallback, blocks };
}
