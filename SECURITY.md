# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public issue for a suspected
vulnerability.

Use GitHub's private vulnerability reporting: the repository's **Security** tab →
**Report a vulnerability**. (Maintainers: enable *Private vulnerability reporting* under the repo's
Security settings.) Reports are acknowledged promptly, and a fix and coordinated disclosure are
arranged with the reporter.

## Scope & posture

ZAM is a context-*planning* layer: it produces plans and traces and does not execute agent actions
itself. A few properties relevant to security:

- **Untrusted content is data, not instructions.** Request text and component content are treated as
  untrusted. Selectors never pattern-match raw user text — the request router is the sole owner of
  injection detection and exposes it to selectors as a precomputed boolean.
- **Fail-open where safe, fail-closed where it matters.** Planning fails open to *fuller* context
  under uncertainty; output writing is fail-closed (an invalid plan is refused, never emitted).
- **Constant-time HTTP auth.** The optional HTTP service compares the `X-ZAM-API-Key` header with a
  length-safe, constant-time comparison.
- **No secrets in artifacts.** Plans and traces must never contain raw secrets, credentials, or raw
  user text.

## Supported versions

The project is pre-1.0; security fixes are applied to `main`.
