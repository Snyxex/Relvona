# Authentication and identity incident response

This runbook defines technical handling only; legal notification deadlines and contractual responsibilities require an organizational incident owner.

## Triage and containment

1. Open an incident record with timestamps in UTC, service/environment, affected organization(s), indicators, current known scope and incident commander.
2. For suspected account takeover: isolate affected principal, revoke Better Auth sessions and long-lived credentials, block compromised login methods or IdPs if justified, and rotate relevant secrets; preserve evidence first where safe.
3. For an Entra callback attack: disable or restrict that SSO provider, examine SSO state audit and IdP logs, correlate affected subject/issuer/tenant, and request user re-enrollment only through verified channels.
4. For leaked `PLATFORM_BOOTSTRAP_TOKEN`: revoke/rotate the deployment secret; verify that initial owner creation has already been completed correctly and that no unauthorized bootstrap actor exists.
5. For Better Auth or dependent package advisory: determine affected versions **and actual plugin activation**, patch through a staged release, reissue incomplete OAuth/verification states if required, and test session integrity.
6. Collect relevant sanitized logs and database audit records; never copy bearer tokens, TOTP secrets, password reset links or customer documents into tickets.

## Recovery and validation

- Verify user and organization membership integrity, role changes, SSO account binding and API-key/sessions revocation.
- Test sign-in, MFA, SSO, password reset, invitation and tenant isolation against a disposable environment.
- Restore access using controlled identity verification, not by bypassing MFA or granting permanent emergency administrator rights.
- Notify relevant legal/privacy/security contacts to decide whether GDPR breach notification or external reporting is required.
- Capture mitigations, residual risk, postmortem and owners with due dates.

**Open:** Automated account-takeover risk scoring, tamper-evident SIEM export, JIT break-glass approvals and incident-driven session sweeps are not complete.
