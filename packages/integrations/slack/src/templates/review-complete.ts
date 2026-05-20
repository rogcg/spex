import type { SlackBlockKitMessage } from '../types.js';

export interface ReviewCompleteTemplateInput {
  /** PR number (`#234`). */
  prNumber: number;
  /** PR title. */
  prTitle: string;
  /** Full PR URL. */
  prUrl: string;
  /** Repo (`owner/repo`). */
  repo: string;
  /** Top-level verdict reported by `spex review`. */
  verdict: 'approve' | 'request_changes' | 'comment';
  /** Total number of findings the review surfaced. */
  findingCount: number;
  /** Up to 3 highest-severity findings rendered in the message. */
  topFindings: readonly { severity: string; summary: string }[];
}

const VERDICT_LABELS: Record<ReviewCompleteTemplateInput['verdict'], string> = {
  approve: '✅ Approved',
  request_changes: '🛑 Changes requested',
  comment: '💬 Comment posted',
};

/**
 * Slack Block Kit template posted after `spex review` finishes posting its
 * structured review comment on a GitHub PR. Notify-only.
 */
export function buildReviewCompleteTemplate(
  input: ReviewCompleteTemplateInput,
): SlackBlockKitMessage {
  const title = input.prTitle.length > 140 ? `${input.prTitle.slice(0, 137)}…` : input.prTitle;
  const findings =
    input.topFindings.length === 0
      ? '_(no findings)_'
      : input.topFindings.map((f) => `• *${f.severity}* — ${f.summary}`).join('\n');
  const fallback = `SPEX review posted on PR #${input.prNumber} (${input.repo}) — ${VERDICT_LABELS[input.verdict]}`;
  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔍 SPEX review posted' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*PR #${input.prNumber}* — ${title}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repo*\n${input.repo}` },
          { type: 'mrkdwn', text: `*Verdict*\n${VERDICT_LABELS[input.verdict]}` },
          { type: 'mrkdwn', text: `*Findings*\n${input.findingCount}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Top findings*\n${findings}` },
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
