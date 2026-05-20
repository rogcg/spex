import type { SlackBlockKitMessage } from '../types.js';

export interface PrOpenedTemplateInput {
  /** Branch the PR was opened from (e.g. `feature/add-pagination`). */
  branch: string;
  /** Feature description / PR title. */
  title: string;
  /** Full PR URL. */
  prUrl: string;
  /** GitHub repo (`owner/repo`). */
  repo: string;
  /** SPEX command that produced the PR (`implement` | `fix`). */
  source: 'implement' | 'fix';
}

/**
 * Slack Block Kit template posted when SPEX opens a pull request.
 *
 * Notification-only (no buttons): the PR is already on GitHub, the human's
 * action is to review on GitHub directly.
 */
export function buildPrOpenedTemplate(input: PrOpenedTemplateInput): SlackBlockKitMessage {
  const title = input.title.length > 140 ? `${input.title.slice(0, 137)}…` : input.title;
  const fallback = `SPEX opened PR for ${input.title} on ${input.repo} (${input.branch})`;
  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: input.source === 'fix' ? '🛠️ SPEX fix → PR opened' : '✨ SPEX implement → PR opened',
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repo*\n${input.repo}` },
          { type: 'mrkdwn', text: `*Branch*\n\`${input.branch}\`` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open PR' },
            url: input.prUrl,
            action_id: 'spex_open_pr',
          },
        ],
      },
    ],
  };
}
