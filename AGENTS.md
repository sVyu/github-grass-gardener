# Agent development guide

This repository implements the MVP specified in `docs/`. Read the relevant product, domain, architecture, risk, and implementation documents before changing behavior. If a specification is ambiguous, record the chosen behavior beside the relevant code or in an ADR.

## Workflow

1. Turn each feature's acceptance criteria and failure cases into tests first. Confirm the tests fail for the expected reason.
2. Implement the smallest behavior that passes those tests, then refactor and run the affected suite.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before completing a meaningful unit of work.
4. Commit by coherent feature or layer. Use a short imperative subject, 3–4 descriptive body lines, and a model-specific `Co-authored-by` trailer when an agent substantially contributed.
5. Keep implementation details and the current state of checks in the handoff. Do not claim GitHub has counted a contribution until its calendar confirms it.

## Architecture

- `src/domain` is pure TypeScript and does not depend on React, DOM, Octokit, or Electron.
- `src/application` coordinates use cases through interfaces. GitHub network calls live in `src/adapters`.
- Validate external API responses at the adapter boundary. UI components consume application-level data and actions.
- Keep authentication credentials in process memory in the Web client. Never place tokens in URLs, browser storage, source files, test fixtures, snapshots, or logs.

## GitHub write safety

- MVP Gardening edits unpublished plans only. Do not rewrite published history or use force pushes.
- Publish only after an explicit user action and a fresh check of the target branch HEAD.
- Append commits sequentially and update refs with `force: false`. Stop and report a conflict if the branch changes.
- Use a GitHub-verified author email, an explicit IANA time zone, and a real content change for each planned commit.
- Treat GitHub's contribution calendar as the source of truth for counted contributions.
