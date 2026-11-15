# Security Policy

## Supported Versions

Security fixes are applied to the latest release on the `main` branch (`1.0.x`).

## Reporting a Vulnerability

Do **not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately to the maintainers:

1. Open a private security advisory on GitHub at `https://github.com/owner/patchwork/security/advisories/new`, **or**
2. Email `security@example.com` with:
   - Affected component or route
   - Steps to reproduce or proof of concept
   - Impact assessment

We acknowledge reports within 48 hours and provide a remediation timeline once reproduced.

## Operational Security Notes

- Never commit `.env` or share `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, or `CSRF_SECRET`.
- Do not regenerate `TOKEN_ENCRYPTION_KEY` while an unconfirmed Admin Setup Token exists.
- The initial members CSV downloaded during the Setup Wizard contains plaintext temporary passwords; store it securely and delete it after distribution.
