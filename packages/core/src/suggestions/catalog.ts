/**
 * A description of SPEX and its CLI command catalog, injected into the system
 * prompt so the model can reason about which command naturally comes next in
 * the flow. Kept here (not in the CLI strings file) because it is model-facing
 * knowledge, not a user-facing string.
 */
export const SPEX_CATALOG = `SPEX (Spec-driven Programming EXecutor) is an AI agent orchestration framework for software development. It works through: interactive discovery, versioned specs written under .ai/, human approval gates (AI proposes, human approves, AI executes), and a multi-mode runtime (CLI, MCP server, library).

The typical flow is:
1. Create or adopt a project so a tech spec lives under .ai/ (spex new / spex init).
2. Implement features or fix bugs against that spec, each producing a branch and (optionally) a pull request (spex implement / spex fix).
3. Review the resulting pull request (spex review).
4. Inspect the audit trail or resume paused work at any time (spex logs / spex resume).

CLI commands:
- spex new <name>: Scaffold a brand-new SPEX-managed project from scratch, including its tech spec under .ai/.
- spex init: Adopt SPEX inside an EXISTING project by detecting the stack and writing .ai/tech-spec.yaml.
- spex implement "<feature>": Implement a feature — generates a feature spec, an implementation plan, applies it, commits, and can open a PR.
- spex fix "<bug>": Diagnose a bug (ranked hypotheses + root cause), propose and verify a fix with a regression test, then commit.
- spex review <pr>: Review a GitHub pull request against the linked specs and post the review comment.
- spex resume [--list]: List or resume paused workflows saved under .ai/scratch/.
- spex logs: Inspect the audit trail (what SPEX did, when, and by which actor).
- spex github setup: Configure the GitHub integration so SPEX can open and review PRs.
- spex skills install: Install the SPEX skill bundles for use in an MCP-compatible IDE.

Guidance for suggestions:
- Suggest 2 to 4 commands that make sense as the immediate next step given what just happened.
- Order them from most to least likely to be what the user wants next.
- Use the exact command syntax above. Keep placeholders like "<feature>" when the user must supply text.
- Do not suggest re-running the command that just completed unless it genuinely makes sense (e.g. implementing another feature).
- Keep each reason to a single short sentence.`;
