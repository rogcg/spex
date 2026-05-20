export const STRINGS = {
  banner: {
    title: 'SPEX',
    subtitle: 'Spec-driven Programming EXecutor',
  },

  newCommand: {
    description: 'Create a new SPEX-managed project',
    argDescription: 'project name (lowercase letters, numbers, dashes)',

    aboutToCreate: (name: string) => `About to create a new project: ${name}`,
    confirmProjectName: (name: string) => `Create project "${name}"?`,
    cancelled: 'Cancelled. No changes were made.',

    discoveryHeader: "\nLet's understand your project. A few quick questions:\n",

    generatingSpec: '\nGenerating tech spec via Claude...',
    specReady: '\n=== Generated tech-spec.yaml ===\n',
    specReadyFooter: '=== end of tech-spec.yaml ===\n',
    confirmApproveSpec: 'Approve this tech spec and proceed with scaffolding?',

    scaffolding: (name: string) => `\nScaffolding ${name} with create-next-app...`,
    injectingAi: 'Writing .ai/ folder...',
    gitInit: 'Recording .ai/ folder in git...',

    success: (name: string, dir: string) =>
      `\nProject "${name}" created at:\n  ${dir}\n\nNext steps:\n  cd ${name}\n  pnpm dev\n`,
  },

  initCommand: {
    description: 'Add SPEX `.ai/` infrastructure to an existing project',
    forceFlagDescription: 'overwrite an existing .ai/ directory',

    starting: (dir: string) => `Initialising SPEX in: ${dir}`,
    aiFolderExists: (path: string) =>
      `Error: ${path} already exists. Re-run with --force to overwrite, or remove the directory manually.`,

    detecting: 'Detecting existing stack...',
    detectionFailed: (message: string) => `Error: ${message}`,
    detectionSummaryHeader: '\n=== Detected stack ===',
    detectionSummaryFooter: '=== end of detection ===\n',
    confirmDetection: 'Does this match the project? Continue with these detected values?',

    discoveryHeader: '\nA few follow-up questions for context that cannot be detected:\n',

    generatingSpec: '\nGenerating tech spec via Claude...',
    specReady: '\n=== Generated tech-spec.yaml ===\n',
    specReadyFooter: '=== end of tech-spec.yaml ===\n',
    inferredNotice: (fields: readonly string[]) =>
      `Note: the following fields were inferred from the existing project — review carefully:\n${fields
        .map((f) => `  - ${f}`)
        .join('\n')}\n`,
    confirmApproveSpec: 'Approve this tech spec and write .ai/?',

    writingAi: 'Writing .ai/ folder...',
    cancelled: 'Cancelled. No changes were made.',
    success: (dir: string) =>
      `\n.ai/ initialised at:\n  ${dir}\n\nReview .ai/tech-spec.yaml and adjust inferred values as needed.\n`,
  },

  implementCommand: {
    description: 'Implement a feature in the current project',
    argDescription: 'one-line description of the feature to implement',
    autoFlagDescription: 'skip approval gates (dangerous — applies everything without prompting)',
    dryRunFlagDescription: 'show what would happen without writing any files or running git',
    noGitFlagDescription: 'skip branch creation and commits',
    fromIssueFlagDescription:
      'source description from a Linear issue id (e.g. SPX-47). Reads title+description from Linear; requires LINEAR_API_KEY.',

    missingDescription:
      'Error: provide a feature description.\n  Example: spex implement "add pagination to the user list"',
    fromIssueAndDescriptionConflict:
      'Error: pass either a description argument OR --from-issue, not both.',
    fromIssueInvalidFormat: (raw: string) =>
      `Error: --from-issue value "${raw}" is not a Linear issue identifier. Expected something like "SPX-47".`,
    fromIssueMissingApiKey:
      'Error: --from-issue requires LINEAR_API_KEY. Generate a key at https://linear.app/settings/api and export LINEAR_API_KEY before retrying.',
    fromIssueFetching: (id: string) => `\n[0/5] Fetching Linear issue ${id}...`,
    fromIssueFetched: (opts: { identifier: string; title: string; url: string }) =>
      `  - ${opts.identifier}: ${opts.title}\n  - ${opts.url}`,
    fromIssueFetchFailed: (id: string, reason: string) =>
      `Error: failed to fetch Linear issue ${id}: ${reason}`,
    fromIssueEmptyBody: (id: string) =>
      `Error: Linear issue ${id} has neither a title nor a description; cannot derive a feature description.`,
    notAGitRepo:
      'Error: not inside a git repository. Run `git init` first or pass --no-git to skip git operations.',
    dirtyWorkingTree: (entries: readonly string[]) =>
      `Error: working tree has uncommitted changes. Commit or stash them before running spex implement, or pass --no-git.\n${entries
        .map((line) => `  ${line}`)
        .join('\n')}`,
    branchExists: (branch: string) =>
      `Error: branch "${branch}" already exists. Delete it or rename the feature before retrying.`,

    autoModeWarning:
      'Warning: running in --auto mode — approval gates are skipped. Source changes, tests, and commits will be applied automatically.',

    aboutToImplement: (description: string) => `\nFeature request:\n  ${description}\n`,

    phase1Header: '\n[1/5] Reading codebase context...',
    contextSummary: (opts: {
      files: number;
      truncated: boolean;
      excluded: number;
      framework: string;
      patterns: string;
    }) =>
      `  - files indexed: ${opts.files}${opts.truncated ? ` (truncated, ${opts.excluded} dropped)` : ''}\n  - stack: ${opts.framework}\n  - patterns: ${opts.patterns}`,

    phase2Header: '\n[2/5] Generating feature spec via Claude...',
    featureSpecPreviewStart: '\n=== Proposed feature spec ===\n',
    featureSpecPreviewEnd: '=== end of feature spec ===\n',
    confirmApproveFeatureSpec: 'Approve this feature spec?',

    phase3Header: '\n[3/5] Generating implementation plan via Claude...',
    planPreviewStart: '\n=== Proposed implementation plan ===\n',
    planPreviewEnd: '=== end of plan ===\n',
    confirmApprovePlan: 'Approve this implementation plan?',

    phase4Header: (mode: string) => `\n[4/5] Executing plan (mode: ${mode})...`,
    creatingBranch: (branch: string) => `  Creating branch: ${branch}`,
    writingFeatureSpec: (relPath: string) => `  Writing ${relPath}`,
    opAboutToApply: (order: number, kind: string, path: string) =>
      `  → operation #${order} (${kind}): ${path}`,
    confirmApplyOperation: 'Apply this operation?',
    operationSkipped: '  ⤵ skipped',
    operationApplied: '  ✓ applied',

    dryRunDone: (count: number) =>
      `\nDry run complete. ${count} operation(s) would be applied. No files were written.`,
    executionDone: (opts: { applied: number; skipped: number }) =>
      `  ${opts.applied} operation(s) applied${opts.skipped > 0 ? `, ${opts.skipped} skipped` : ''}.`,

    phase5Header: '\n[5/5] Committing changes...',
    committingChanges: (sha: string) => `  feat commit: ${sha.slice(0, 10)}`,
    committingTests: (sha: string) => `  test commit: ${sha.slice(0, 10)}`,
    noChangesToCommit: '  (no changes were applied — nothing to commit)',
    gitDisabled: '\nGit operations skipped (--no-git or --dry-run).',

    success: (opts: { branch: string | null; auditLog: string | null }) =>
      `\nDone.${opts.branch ? `\n  Branch: ${opts.branch}` : ''}${opts.auditLog ? `\n  Audit log: ${opts.auditLog}` : ''}\n`,

    cancelled: 'Cancelled. No changes were applied.',
  },

  fixCommand: {
    description: 'Diagnose a bug and propose + verify a fix',
    argDescription: 'one-line description of the bug',
    affectedFlagDescription: 'project-relative file path the bug appears in (repeatable)',
    errorMessageFlagDescription: 'optional error message text',
    errorStackFlagDescription: 'optional stack trace text',
    autoFlagDescription:
      'skip approval gates (dangerous — applies the recommended fix without prompting)',
    dryRunFlagDescription: 'show the analysis + proposed fix without writing or running git',
    noGitFlagDescription: 'skip branch creation and commit',
    fromErrorFlagDescription:
      'pull bug context from a structured error source — supported: `posthog:<issue-id>` or bare `<issue-id>` (defaults to posthog)',

    missingDescription:
      'Error: provide a bug description.\n  Example: spex fix "pagination resets when I change a filter"',
    fromErrorUnsupportedSource: (source: string) =>
      `Error: --from-error source "${source}" is not supported yet. Supported: posthog:<issue-id>.`,
    fromErrorAndDescriptionConflict: 'Error: pass either a description or --from-error, not both.',
    fromErrorMissingPosthogApiKey:
      'Error: POSTHOG_API_KEY is not set. Generate a personal API key with the "MCP Server" preset at https://posthog.com (Settings → User → Personal API Keys) and set POSTHOG_API_KEY before running with --from-error=posthog.',
    fromErrorFetching: (id: string) => `\nFetching PostHog error issue ${id}...`,
    fromErrorFetched: (opts: {
      id: string;
      occurrences: number | null;
      affectedUsers: number | null;
      recordings: number;
    }) =>
      `  ✓ ${opts.id} (occurrences=${opts.occurrences ?? '?'}, affectedUsers=${
        opts.affectedUsers ?? '?'
      }, session recordings=${opts.recordings})`,
    fromErrorFetchFailed: (id: string, reason: string) =>
      `Error: failed to fetch PostHog issue ${id}: ${reason}`,
    notAGitRepo:
      'Error: not inside a git repository. Run `git init` or pass --no-git to skip git operations.',
    dirtyWorkingTree: (entries: readonly string[]) =>
      `Error: working tree has uncommitted changes. Commit or stash them, or pass --no-git.\n${entries
        .map((line) => `  ${line}`)
        .join('\n')}`,

    autoModeWarning:
      'Warning: running in --auto mode — approval gates are skipped. The top-ranked hypothesis, recommended fix option, and generated regression test will all be applied automatically.',

    aboutToDebug: (description: string) => `\nBug:\n  ${description}\n`,

    phase1Header: '\n[1/6] Reading codebase + bug context...',
    contextSummary: (opts: {
      files: number;
      affected: number;
      commits: number;
      framework: string;
    }) =>
      `  - files indexed: ${opts.files}\n  - bug-context affected files: ${opts.affected}\n  - recent commits collected: ${opts.commits}\n  - test framework: ${opts.framework}`,

    phase2Header: '\n[2/6] Generating ranked hypotheses via Claude...',
    hypothesesPreviewStart: '\n=== Hypotheses ===\n',
    hypothesesPreviewEnd: '=== end of hypotheses ===\n',
    pickHypothesisPrompt: 'Pick a hypothesis to investigate first',

    phase3Header: (hypothesisId: string) =>
      `\n[3/6] Analysing root cause for ${hypothesisId} via Claude...`,
    rootCauseConfirmed: '  Root cause confirmed.',
    rootCauseRefuted: (next: string) => `  Refuted. Trying next: ${next}`,
    rootCausePreviewStart: '\n=== Root cause ===\n',
    rootCausePreviewEnd: '=== end of root cause ===\n',
    confirmApproveRootCause: 'Approve this root cause and proceed to fix proposal?',

    phase4Header: '\n[4/6] Generating fix proposal via Claude...',
    proposalPreviewStart: '\n=== Fix proposal ===\n',
    proposalPreviewEnd: '=== end of fix proposal ===\n',
    pickFixOptionPrompt: 'Pick a fix option to apply',

    phase5Header: '\n[5/6] Generating regression test via Claude...',
    regressionTestPreviewStart: '\n=== Regression test ===\n',
    regressionTestPreviewEnd: '=== end of regression test ===\n',
    confirmApproveRegressionTest: 'Approve this regression test?',

    phase6Header: '\n[6/6] Verifying fail-then-pass cycle...',
    creatingBranch: (branch: string) => `  Creating branch: ${branch}`,
    verifying: '  Running test before applying the fix...',
    verifierBefore: (exit: number | null) => `    before-fix exit code: ${exit}`,
    verifierApplyingFix: '  Applying the fix...',
    verifierAfter: (exit: number | null) => `    after-fix exit code: ${exit}`,
    committing: (sha: string) => `  fix commit: ${sha.slice(0, 10)}`,

    dryRunDone: '\nDry run complete. No files were modified.',
    success: (opts: { branch: string | null; commit: string | null }) =>
      `\nDone.${opts.branch ? `\n  Branch: ${opts.branch}` : ''}${
        opts.commit ? `\n  Commit: ${opts.commit.slice(0, 10)}` : ''
      }\n`,
    cancelled: 'Cancelled. No changes were applied.',
  },

  posthogWebhookCommand: {
    description:
      'Handle a PostHog error-tracking webhook delivery: parse, apply filter, optionally auto-trigger spex fix',
    payloadPathFlagDescription: 'path to a JSON file containing the webhook payload',
    signatureFlagDescription:
      'PostHog signature header value (e.g. `sha256=…`) — used to verify the payload against POSTHOG_WEBHOOK_SECRET',
    secretFlagDescription: 'override POSTHOG_WEBHOOK_SECRET env var for signature verification',
    dryRunFlagDescription:
      'parse the payload + apply the filter, but do not invoke spex fix on a trigger decision',

    integrationNotConfigured:
      'Error: PostHog integration not configured. Add `integrations.posthog.auto_fix` to .ai/config.yaml.',
    invalidConfig: (issues: readonly string[]) =>
      `Error: invalid .ai/config.yaml:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    missingPayloadPath: 'Error: provide --payload-path pointing to the JSON-decoded webhook body.',
    payloadReadFailed: (path: string, reason: string) =>
      `Error: failed to read payload at ${path}: ${reason}`,
    invalidPayload: (reason: string) => `Error: failed to parse webhook payload: ${reason}`,
    signatureWithoutSecret:
      'Error: --signature was supplied but no secret is configured. Set POSTHOG_WEBHOOK_SECRET or pass --secret.',
    signatureMismatch: 'Error: PostHog webhook signature did not match. Rejecting payload.',
    signatureVerified: '  ✓ webhook signature verified.',
    signatureSkippedWithSecret:
      '  ⚠ POSTHOG_WEBHOOK_SECRET is set but no --signature header was supplied; skipping signature check.',
    signatureSkippedNoSecret:
      '  ⚠ No webhook secret configured — skipping signature verification. Set POSTHOG_WEBHOOK_SECRET in production.',
    eventSummary: (event: {
      kind: string;
      issueId?: string;
      severity?: string | null;
      occurrences?: number | null;
    }) => {
      const id = 'issueId' in event && event.issueId ? event.issueId : '<n/a>';
      const sev = 'severity' in event && event.severity ? event.severity : 'unknown';
      const occ =
        'occurrences' in event && typeof event.occurrences === 'number'
          ? String(event.occurrences)
          : '?';
      return `\nEvent: ${event.kind}\n  issueId: ${id}\n  severity: ${sev}\n  occurrences: ${occ}`;
    },
    skipped: (reason: string) => `\nSkipping auto-fix: ${reason}`,
    dryRunTrigger: (issueId: string) =>
      `\n[dry-run] Would trigger: spex fix --from-error=posthog:${issueId} --auto`,
    triggering: (issueId: string) =>
      `\nTriggering auto-fix for posthog:${issueId} (PR will be opened with the auto-fix label).`,
  },

  slackWebhookCommand: {
    description:
      'Handle a Slack webhook delivery (slash command or block_actions interactive payload): verify signature, parse, route to the matching SPEX flow',
    payloadPathFlagDescription: 'path to a file containing the raw Slack request body',
    signatureFlagDescription:
      'Slack signature header value (X-Slack-Signature, e.g. `v0=…`) — used to verify the payload',
    timestampFlagDescription:
      'Slack request timestamp header value (X-Slack-Request-Timestamp, unix seconds)',
    secretFlagDescription: 'override SLACK_SIGNING_SECRET env var for signature verification',
    dryRunFlagDescription: 'parse + verify the payload, but do not invoke any downstream SPEX flow',

    integrationNotConfigured:
      'Error: Slack integration not configured. Add `integrations.slack` to .ai/config.yaml.',
    invalidConfig: (issues: readonly string[]) =>
      `Error: invalid .ai/config.yaml:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    missingPayloadPath: 'Error: provide --payload-path pointing to the raw Slack request body.',
    payloadReadFailed: (path: string, reason: string) =>
      `Error: failed to read payload at ${path}: ${reason}`,
    invalidPayload: (reason: string) => `Error: failed to parse Slack payload: ${reason}`,
    missingSigningSecret:
      'Error: SLACK_SIGNING_SECRET is not set and no --secret was supplied. Configure your Slack app signing secret before processing live deliveries.',
    signatureMismatch:
      'Error: Slack request signature did not verify. Rejecting payload (signature mismatch or timestamp outside the 5-minute window).',
    signatureVerified: '  ✓ Slack signature verified.',
    unknownEventReason: (reason: string) => `\nIgnoring Slack delivery: ${reason}`,
    dispatchSlashCommand: (kind: string, by: string) =>
      `\nDispatching slash command (${kind}) invoked by ${by}.`,
    permissionDenied: (reason: string) =>
      `\nRejecting slash command — permission check failed: ${reason}`,
    approvalRecorded: (opts: { correlationId: string; userId: string; status: string }) =>
      `\nApproval ${opts.correlationId} updated by ${opts.userId} — status now: ${opts.status}.`,
    approvalNotApprover: (userId: string) =>
      `\nUser ${userId} is not on the approver list — decision ignored.`,
    approvalDuplicate: (userId: string) =>
      `\nUser ${userId} already voted on this approval — decision ignored.`,
    approvalExpired: '\nApproval has expired and was finalised before the decision arrived.',
    approvalAlreadyFinalised: '\nApproval is already finalised — decision ignored.',
    approvalMissing: (correlationId: string) =>
      `\nNo approval record found for correlation id ${correlationId} — webhook ignored.`,
    dryRunPreview: (summary: string) => `\n[dry-run] Would dispatch: ${summary}`,
  },

  mcpServerCommand: {
    description: 'Start SPEX as an MCP server (consumable by Claude Code, Cursor, etc.)',
    transportFlagDescription: 'Transport to use (stdio is the only supported option)',
    portFlagDescription: 'TCP port for the HTTP transport (placeholder — not yet supported)',

    httpNotSupported:
      'Error: HTTP transport is not supported yet. Use --transport=stdio (default).',
    unsupportedTransport: (value: string) =>
      `Error: unsupported transport "${value}". Only "stdio" is supported.`,

    startupMessage: 'SPEX MCP server listening on stdio',
    shutdownMessage: (signal: string) => `Shutting down (${signal})`,
  },

  githubSetupCommand: {
    description: 'Install SPEX GitHub Actions workflow templates into this project',
    setupDescription: 'Install workflow templates into .github/workflows/',
    forceFlagDescription: 'overwrite existing workflow files at .github/workflows/<name>.yml',

    starting: (dir: string) => `\nInstalling SPEX workflow templates into:\n  ${dir}`,
    wrote: (relPath: string) => `  ✓ wrote ${relPath}`,
    skipped: (relPath: string) =>
      `  ⤵ skipped ${relPath} (already exists — re-run with --force to overwrite)`,
    summary: (opts: { written: number; skipped: number; forceUsed: boolean }) => {
      const parts = [`\nDone. ${opts.written} written, ${opts.skipped} skipped.`];
      if (opts.skipped > 0 && !opts.forceUsed) {
        parts.push('Add --force to overwrite skipped files.');
      }
      parts.push('');
      parts.push('Required repo secrets:');
      parts.push('  - ANTHROPIC_API_KEY  (used by SPEX to call Claude)');
      parts.push('  - GITHUB_TOKEN       (provided automatically by GitHub Actions)');
      parts.push('');
      return parts.join('\n');
    },
  },

  reviewCommand: {
    description: 'Review a GitHub PR against its linked spec and project conventions',
    argDescription: 'PR number (e.g. 42) or full PR URL',
    autoFlagDescription: 'skip the confirm-before-post prompt and post immediately',
    dryRunFlagDescription: 'generate the review and print the comment without posting to GitHub',

    missingRef:
      'Error: provide a PR number or URL.\n  Examples:\n    spex review 42\n    spex review https://github.com/owner/repo/pull/42',
    missingOwnerRepo:
      'Error: owner/repo could not be determined. Use a full PR URL, or add `integrations.github.{owner, repo}` to .ai/config.yaml.',
    missingToken:
      'Error: GITHUB_TOKEN is not set. Set it in your environment or .env file before running spex review.',

    fetchingPr: (n: number, owner: string, repo: string) =>
      `\nFetching PR #${n} from ${owner}/${repo}...`,
    fetchingDiff: '  Fetching unified diff...',
    emptyDiff: '  PR diff is empty — nothing to review.',
    foundFeatureSpec: (path: string) => `  Linked feature spec: ${path}`,
    featureSpecMissing: (path: string) =>
      `  Branch suggests ${path} but the file was not found — reviewing against tech spec + diff only.`,
    foundTechSpec: '  Linked tech spec: .ai/tech-spec.yaml',
    buildingContext: '  Reading codebase context...',
    generating: (mode: string) => `  Generating review via Claude (mode: ${mode})...`,
    previewStart: '\n=== Proposed review comment ===\n',
    previewEnd: '\n=== end of review comment ===\n',
    confirmPost: (n: number) => `Post this review to PR #${n}?`,
    cancelled: 'Cancelled. No comment was posted.',
    posted: (url: string) => `\n✓ Posted: ${url}\n`,
    dryRunDone: '\nDry run complete. No comment was posted.',
    usingHost: (host: string) => `  (host: ${host})`,
  },

  githubPr: {
    integrationNotConfigured:
      '\nGitHub integration not configured. Add .ai/config.yaml with `integrations.github.{owner, repo, auto_create_pr: true}` to open PRs automatically.',
    autoCreatePrDisabled:
      '\nGitHub integration found but `auto_create_pr` is false — skipping PR creation.',
    missingToken:
      '\nGITHUB_TOKEN is not set — skipping PR creation. Set GITHUB_TOKEN in your environment or .env file to enable PR creation.',
    noCommitsToPush: '\nNo commits were created on this branch — skipping PR creation.',
    invalidConfig: (issues: readonly string[]) =>
      `\nError: .ai/config.yaml is invalid:\n${issues.map((i) => `  - ${i}`).join('\n')}\nSkipping PR creation.`,
    polishingDescription: '  Polishing PR description via Claude...',
    pushing: (branch: string, owner: string, repo: string) =>
      `  Pushing ${branch} to ${owner}/${repo}...`,
    creating: (base: string) => `  Opening PR against ${base}...`,
    created: (opts: { url: string; number: number; labels: readonly string[] }) =>
      `  ✓ PR #${opts.number}: ${opts.url}${opts.labels.length > 0 ? `\n    labels: ${opts.labels.join(', ')}` : ''}`,
    pushFailed: (message: string) =>
      `\nError: failed to push branch. ${message}\nPR was NOT opened. Your local commits are intact.`,
    createFailed: (message: string) =>
      `\nError: branch was pushed but creating the PR failed. ${message}\nOpen the PR manually from the GitHub UI.`,
  },

  linearSyncCommand: {
    description:
      'Sync a GitHub PR lifecycle event to the linked Linear issue (intended for use inside a workflow)',
    eventFlagDescription: 'PR event kind: opened | merged | closed_unmerged',
    eventPathFlagDescription:
      'path to a GitHub Actions `pull_request` event payload (typically $GITHUB_EVENT_PATH)',
    linearIdFlagDescription: 'override Linear issue id (e.g. SPX-47); otherwise auto-detected',
    prNumberFlagDescription: 'PR number (auto-detected from --event-path when omitted)',
    prUrlFlagDescription: 'PR URL (auto-detected from --event-path when omitted)',
    branchFlagDescription: 'PR head branch name (used as a Linear-id extraction fallback)',
    prBodyFlagDescription: 'PR body text (used to find a `Closes <ID>` reference)',
    dryRunFlagDescription: 'log the planned change without calling Linear',

    invalidConfig: (issues: readonly string[]) =>
      `Error: .ai/config.yaml is invalid:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    integrationNotConfigured:
      'Error: Linear integration not configured. Add `integrations.linear.{team: <KEY>}` to .ai/config.yaml.',
    invalidEvent: (raw: string) =>
      `Error: --event "${raw}" is not valid. Expected one of: opened | merged | closed_unmerged.`,
    missingEvent: 'Error: pass either --event or --event-path.',
    eventPayloadFailed: (path: string, reason: string) =>
      `Error: failed to read GitHub event payload at ${path}: ${reason}`,
    missingPrFields:
      'Error: PR number and PR URL are required. Pass --pr-number/--pr-url or --event-path.',
    missingApiKey:
      'Error: LINEAR_API_KEY is not set. Add it to repo secrets and pass it through to the workflow step.',
    noLinearIssueDetected: 'No Linear issue id detected in the PR body or branch — skipping sync.',
    dryRun: (opts: { event: string; linearId: string; prNumber: number; prUrl: string }) =>
      `[dry-run] would sync ${opts.linearId} ← event=${opts.event}, PR=#${opts.prNumber} (${opts.prUrl})`,
    syncing: (id: string, event: string) => `Syncing ${id} ← event=${event}...`,
    synced: (opts: { linearId: string; status: string }) => `  ✓ ${opts.linearId} → ${opts.status}`,
    commentPosted: (url: string) => `  ✓ Comment posted: ${url}`,
    syncFailed: (message: string) => `Error: linear sync failed: ${message}`,
  },

  skillsCommand: {
    description: 'Manage SPEX skill bundles (markdown agent instructions)',
  },

  skillsInstallCommand: {
    description: 'Install SPEX skills into a Claude Code skills directory',
    scopeFlagDescription:
      'where to install: "user" (~/.claude/skills/) or "project" (./.claude/skills/) — default user',

    starting: (scope: string, dest: string) =>
      `\nInstalling SPEX skills (scope: ${scope})\n  into: ${dest}`,
    noSkills: '\nNo skills found in @spex/skills — nothing to install.',
    wrote: (name: string, path: string) => `  ✓ ${name} → ${path}`,
    done: (count: number) => `\nDone. ${count} skill(s) installed.\n`,
    invalidScope: (raw: string) =>
      `Error: invalid scope "${raw}". Use --scope=user or --scope=project.`,
  },

  errors: {
    missingApiKey: (envVar: string) =>
      `Error: ${envVar} is not set. Set it in your environment or a .env file before running spex new.`,
    projectExists: (name: string) =>
      `Error: a directory named "${name}" already exists in this location.`,
    invalidProjectName: (name: string) =>
      `Error: invalid project name "${name}". Use lowercase letters, numbers, and dashes only (e.g. "my-saas").`,
    generic: (message: string) => `Error: ${message}`,
  },
} as const;
