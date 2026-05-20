import { input, select } from '@inquirer/prompts';
import type { DecisionAction, DecisionPrompter, ProposalContext } from '@spex/core';
import type { Decision, DecisionConfidence } from '@spex/schemas';
import { STRINGS } from '../strings.js';

export interface DefaultPrompterOptions {
  /** Override output sink — useful in tests. */
  log?: (line: string) => void;
}

export function defaultDecisionPrompter(opts: DefaultPrompterOptions = {}): DecisionPrompter {
  const log = opts.log ?? ((line: string) => console.log(line));
  return {
    async promptDecision(decision, context) {
      printDecision(log, decision, context);

      const choices: { name: string; value: PrompterChoice }[] = [
        { name: STRINGS.decisionApproval.accept, value: { kind: 'accept' } },
        { name: STRINGS.decisionApproval.reject, value: { kind: 'reject' } },
        { name: STRINGS.decisionApproval.debate, value: { kind: 'debate' } },
        { name: STRINGS.decisionApproval.explore, value: { kind: 'explore' } },
        { name: STRINGS.decisionApproval.modify, value: { kind: 'modify' } },
      ];
      if (decision.alternatives && decision.alternatives.length > 0) {
        for (const alt of decision.alternatives) {
          choices.push({
            name: STRINGS.decisionApproval.pickAlternative(alt.label),
            value: { kind: 'pick-alternative', label: alt.label },
          });
        }
      }
      if (context.scratchPath) {
        choices.push({ name: STRINGS.decisionApproval.pause, value: { kind: 'pause' } });
      }

      const action = await select<PrompterChoice>({
        message: STRINGS.decisionApproval.prompt,
        choices,
      });

      switch (action.kind) {
        case 'accept':
          return { kind: 'accept' };
        case 'explore':
          return { kind: 'explore' };
        case 'pause':
          return { kind: 'pause' };
        case 'pick-alternative':
          return { kind: 'pick-alternative', label: action.label };
        case 'reject': {
          const feedback = await input({
            message: STRINGS.decisionApproval.rejectReasonPrompt,
            validate: (raw) =>
              raw.trim().length > 0 || 'Provide a short reason so the AI can revise.',
          });
          return { kind: 'reject', feedback: feedback.trim() };
        }
        case 'debate': {
          const concern = await input({
            message: STRINGS.decisionApproval.debatePrompt,
            validate: (raw) =>
              raw.trim().length > 0 || 'Describe the concern so the AI can respond.',
          });
          return { kind: 'debate', concern: concern.trim() };
        }
        case 'modify': {
          const value = await input({
            message: STRINGS.decisionApproval.modifyValuePrompt,
            validate: (raw) => raw.trim().length > 0 || 'Provide a non-empty value to apply.',
          });
          const note = await input({
            message: STRINGS.decisionApproval.modifyNotePrompt,
          });
          const trimmedNote = note.trim();
          return trimmedNote.length > 0
            ? { kind: 'modify', value: value.trim(), note: trimmedNote }
            : { kind: 'modify', value: value.trim() };
        }
      }
    },
    emitDebate(_decision, response) {
      log(STRINGS.decisionApproval.debateResponseHeader);
      log(response);
      log(STRINGS.decisionApproval.debateResponseFooter);
    },
    emitInfo(message) {
      log(message);
    },
  };
}

type PrompterChoice =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'debate' }
  | { kind: 'explore' }
  | { kind: 'modify' }
  | { kind: 'pause' }
  | { kind: 'pick-alternative'; label: string };

function printDecision(
  log: (line: string) => void,
  decision: Decision,
  context: ProposalContext,
): void {
  log(STRINGS.decisionApproval.header(context.index + 1, context.total));
  log(STRINGS.decisionApproval.category(decision.category, decision.techSpecPath));
  log(STRINGS.decisionApproval.question(decision.question));
  log(STRINGS.decisionApproval.proposal(decision.proposal));
  log(STRINGS.decisionApproval.rationale(decision.rationale));
  log(STRINGS.decisionApproval.confidence(decision.confidence));
  if (decision.alternatives && decision.alternatives.length > 0) {
    log(STRINGS.decisionApproval.alternativesHeader);
    for (const alt of decision.alternatives) {
      log(`    - ${alt.label}: ${alt.tradeoffs}`);
    }
  }
}

export function describeConfidence(c: DecisionConfidence): string {
  return c;
}

// Helper for the CLI — turn `DecisionAction` into a readable label for logs.
export function describeAction(action: DecisionAction): string {
  switch (action.kind) {
    case 'accept':
      return 'accept';
    case 'reject':
      return `reject: ${action.feedback}`;
    case 'debate':
      return `debate: ${action.concern}`;
    case 'explore':
      return 'explore';
    case 'pick-alternative':
      return `pick: ${action.label}`;
    case 'modify':
      return `modify: ${action.value}`;
    case 'pause':
      return 'pause';
  }
}
