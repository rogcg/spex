import type { Decision, DecisionAlternative } from '@spex/schemas';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { type DecisionAuditEntry, buildAuditEntry } from './audit.js';
import { debateDecision, exploreDecisionAlternatives, reviseDecision } from './generator.js';
import { ProposalPausedError, saveProposalState } from './state.js';

export type DecisionAction =
  | { kind: 'accept' }
  | { kind: 'reject'; feedback: string }
  | { kind: 'debate'; concern: string }
  | { kind: 'explore' }
  | { kind: 'pick-alternative'; label: string }
  | { kind: 'modify'; value: string; note?: string }
  | { kind: 'pause' };

export interface DecisionPrompter {
  /**
   * Ask the user what to do with this decision. Implementations should display
   * the decision and return the user's chosen action. When `decision.alternatives`
   * is non-empty, "pick-alternative" should be selectable.
   */
  promptDecision(decision: Decision, context: ProposalContext): Promise<DecisionAction>;
  /** Surface an inline AI debate response to the user before the next prompt. */
  emitDebate?(decision: Decision, response: string): void;
  /** Surface a status note (e.g. "regenerating alternatives") to the user. */
  emitInfo?(message: string): void;
}

export interface ProposalContext {
  index: number;
  total: number;
  scratchPath?: string;
}

export interface RunProposalApprovalOptions {
  llm: LLMProvider;
  projectName: string;
  decisions: Decision[];
  prompter: DecisionPrompter;
  audit?: {
    write(entry: DecisionAuditEntry): Promise<void>;
  };
  /** Auto-accept every decision without prompting. */
  auto?: boolean;
  /**
   * In `auto` mode, abort if any decision has confidence "low". Has no effect
   * outside auto mode.
   */
  strict?: boolean;
  /** Where to persist state if the user pauses. */
  scratchPath?: string;
  /** Resume an in-progress proposal at this decision index. */
  startIndex?: number;
}

export interface RunProposalApprovalResult {
  decisions: Decision[];
}

export async function runProposalApproval(
  opts: RunProposalApprovalOptions,
): Promise<RunProposalApprovalResult> {
  const decisions: Decision[] = opts.decisions.map((d) => ({ ...d }));
  const originals: Decision[] = opts.decisions.map((d) => ({ ...d }));

  if (opts.auto) {
    return runAutoAccept({
      decisions,
      originals,
      ...(opts.audit ? { audit: opts.audit } : {}),
      strict: opts.strict ?? false,
    });
  }

  const start = opts.startIndex ?? 0;
  for (let i = start; i < decisions.length; i += 1) {
    const original = originals[i];
    if (!original) {
      throw new SpexError(`Missing original decision at index ${i}.`);
    }
    let current = decisions[i];
    if (!current) {
      throw new SpexError(`Missing decision at index ${i}.`);
    }
    current = { ...current, status: 'presented' };
    decisions[i] = current;

    let resolved = false;
    while (!resolved) {
      const action = await opts.prompter.promptDecision(current, {
        index: i,
        total: decisions.length,
        ...(opts.scratchPath ? { scratchPath: opts.scratchPath } : {}),
      });

      switch (action.kind) {
        case 'accept': {
          current = { ...current, status: 'accepted', resolvedValue: current.proposal };
          decisions[i] = current;
          await writeAudit(opts.audit, current, original);
          resolved = true;
          break;
        }
        case 'reject': {
          const revised = await reviseDecision({
            llm: opts.llm,
            decision: current,
            feedback: action.feedback,
          });
          current = { ...revised, status: 'presented' };
          decisions[i] = current;
          break;
        }
        case 'debate': {
          const response = await debateDecision({
            llm: opts.llm,
            decision: current,
            concern: action.concern,
          });
          opts.prompter.emitDebate?.(current, response);
          break;
        }
        case 'explore': {
          const withAlts = await exploreDecisionAlternatives({
            llm: opts.llm,
            decision: current,
          });
          current = { ...withAlts, status: 'presented' };
          decisions[i] = current;
          break;
        }
        case 'pick-alternative': {
          const alternatives: readonly DecisionAlternative[] = current.alternatives ?? [];
          const alt = alternatives.find((a) => a.label === action.label);
          if (!alt) {
            throw new SpexError(
              `Alternative "${action.label}" not present on decision "${current.id}".`,
            );
          }
          current = {
            ...current,
            status: 'modified',
            resolvedValue: alt.label,
            userNote: alt.tradeoffs,
            proposal: alt.label,
            rationale: alt.tradeoffs,
          };
          decisions[i] = current;
          await writeAudit(opts.audit, current, original);
          resolved = true;
          break;
        }
        case 'modify': {
          current = {
            ...current,
            status: 'modified',
            resolvedValue: action.value,
            ...(action.note !== undefined ? { userNote: action.note } : {}),
          };
          decisions[i] = current;
          await writeAudit(opts.audit, current, original);
          resolved = true;
          break;
        }
        case 'pause': {
          if (!opts.scratchPath) {
            throw new SpexError('Cannot pause: no scratchPath configured.');
          }
          await saveProposalState(opts.scratchPath, {
            version: 1,
            pausedAt: new Date().toISOString(),
            projectName: opts.projectName,
            decisions,
            currentIndex: i,
          });
          throw new ProposalPausedError(opts.scratchPath);
        }
      }
    }
  }

  return { decisions };
}

async function runAutoAccept(opts: {
  decisions: Decision[];
  originals: Decision[];
  audit?: { write(entry: DecisionAuditEntry): Promise<void> };
  strict: boolean;
}): Promise<RunProposalApprovalResult> {
  for (let i = 0; i < opts.decisions.length; i += 1) {
    const original = opts.originals[i];
    const current = opts.decisions[i];
    if (!original || !current) continue;
    if (opts.strict && current.confidence === 'low') {
      throw new SpexError(
        `--auto --strict aborted on low-confidence decision "${current.id}" (${current.techSpecPath}). Re-run without --strict or pick a higher-confidence path.`,
      );
    }
    const accepted: Decision = {
      ...current,
      status: 'accepted',
      resolvedValue: current.proposal,
    };
    opts.decisions[i] = accepted;
    await writeAudit(opts.audit, accepted, original);
  }
  return { decisions: opts.decisions };
}

async function writeAudit(
  audit: RunProposalApprovalOptions['audit'],
  decision: Decision,
  original: Decision,
): Promise<void> {
  if (!audit) return;
  await audit.write(buildAuditEntry({ decision, original }));
}
