export type DiscoveryAnswerValue = string | string[] | boolean;

export type DiscoveryAnswers = Record<string, DiscoveryAnswerValue>;

export interface Question {
  id: string;
  prompt: string;
  type: 'input' | 'select' | 'multi-select' | 'confirm';
  choices?: readonly string[];
  /**
   * Optional pre-populated rationale shown by the `/why` navigation command.
   * The architect agent populates this on every question it generates.
   */
  rationale?: string;
}
