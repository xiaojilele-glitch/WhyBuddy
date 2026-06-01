# Security Policy

## Supported Versions

WhyBuddy is in early active development. Security fixes are handled on the main development line unless a maintainer explicitly announces supported release branches.

| Version | Supported |
| ------- | --------- |
| `main` | Yes |
| older snapshots | No |

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow for this repository when available. If that is not available, contact a maintainer through the repository's listed project channels and include "Security" in the subject.

Include the following when possible:

- A short description of the vulnerability.
- Steps to reproduce.
- Affected files, routes, APIs, or services.
- Expected impact.
- Any proof-of-concept details that are safe to share privately.
- Your preferred contact method for follow-up.

## Scope

Reports are especially useful when they involve:

- Authentication, authorization, or permission bypass.
- Secret exposure, token leakage, or unsafe environment handling.
- Server-side request forgery, path traversal, command injection, or sandbox escape.
- Unsafe executor behavior, Docker boundary issues, or unintended host access.
- Cross-site scripting or data exfiltration in the client.
- Supply-chain risks in dependencies, build scripts, or release workflows.

## Out of Scope

- Social engineering.
- Denial-of-service reports without a practical security impact.
- Findings that require full local machine compromise first.
- Automated scanner output without a reproducible issue.
- Reports against third-party services not controlled by this project.

## Response Expectations

Maintainers will try to acknowledge valid reports as soon as practical, reproduce the issue, assess severity, and coordinate a fix before public disclosure. Please give maintainers a reasonable window to investigate before publishing details.
