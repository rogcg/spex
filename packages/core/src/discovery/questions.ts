export type DiscoveryAnswerValue = string | string[] | boolean;

export type DiscoveryAnswers = Record<string, DiscoveryAnswerValue>;

export interface Question {
  id: string;
  prompt: string;
  type: 'input' | 'select' | 'multi-select' | 'confirm';
  choices?: readonly string[];
  /**
   * Optional pre-populated rationale shown by the `/why` navigation command.
   * Architect-agent-generated questions may populate this; static questions
   * generally do not.
   */
  rationale?: string;
}

export const SPRINT_1_QUESTIONS: readonly Question[] = [
  {
    id: 'project_type',
    prompt: 'What kind of application are you building?',
    type: 'input',
  },
  {
    id: 'primary_users',
    prompt: 'Who are the primary users?',
    type: 'select',
    choices: [
      'Consumers (B2C)',
      'Small businesses (SMB)',
      'Enterprise',
      'Internal team',
      'Developers',
    ],
  },
  {
    id: 'expected_scale',
    prompt: 'Expected scale in first year?',
    type: 'select',
    choices: ['Less than 100 users', '100-1000 users', '1000-10000 users', 'More than 10000 users'],
  },
  {
    id: 'auth_requirements',
    prompt: 'Authentication requirements?',
    type: 'select',
    choices: [
      'None',
      'Email/password only',
      'OAuth (Google, GitHub, etc.)',
      'Multi-tenant with SSO',
    ],
  },
  {
    id: 'data_persistence',
    prompt: 'Data persistence needs?',
    type: 'select',
    choices: [
      'No backend (static site)',
      'Simple key-value',
      'Relational database',
      'Multi-source complex data',
    ],
  },
] as const;
