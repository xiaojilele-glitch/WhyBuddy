# Contributing to WhyBuddy

Thanks for helping improve WhyBuddy. This project is moving toward a Project-first Task Autopilot platform, so contributions are most useful when they keep the product story, runtime behavior, and evidence trail aligned.

## Good First Contributions

- Fix documentation that is stale, unclear, or missing important context.
- Improve focused tests around an existing behavior.
- Reproduce and narrow a reported bug.
- Polish UI states without changing product semantics.
- Add small integration improvements that follow existing patterns.

For larger product or architecture changes, open an issue first so the direction can be discussed before implementation.

## Local Setup

Requirements:

- Node.js 22+
- pnpm
- Docker, optional, for full executor behavior

Install dependencies:

```bash
pnpm install
```

Run the frontend-only development mode:

```bash
pnpm run dev:frontend
```

Run the full local stack:

```bash
pnpm run dev:all
```

## Validation

Before opening a pull request, run the checks that match the change:

```bash
node --run check
pnpm run test
```

For release-sensitive changes, use the aggregate release path:

```bash
pnpm run test:release
```

If a repo-wide command fails because of unrelated existing issues, mention that clearly in the pull request and include the focused checks you did run.

## Pull Request Guidelines

- Keep pull requests focused on one change or one closely related set of changes.
- Explain the user-facing behavior, not just the files changed.
- Include screenshots or short recordings for visible UI changes.
- Add or update tests when changing behavior, contracts, state, routing, runtime flows, or server APIs.
- Avoid broad formatting churn in unrelated files.
- Do not include secrets, tokens, private endpoints, or local machine-specific data.

## Documentation Guidelines

- Keep progress metrics precise. Do not mix document-sync status, checklist completion, and runtime implementation status.
- Prefer concrete file paths, commands, and validation evidence over general claims.
- If a README or visual artifact describes progress, name the metric being shown.

## Community Standards

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
