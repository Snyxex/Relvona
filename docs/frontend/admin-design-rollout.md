# Relvona admin visual-system rollout

## First migration batch

This PR introduces shared, reusable admin UI primitives at
\`frontend/src/components/admin/admin-ui.tsx\`. Their palette and spacing
follow the existing light Relvona workspace and \`rv-app-surface\` tokens,
while leaving the platform sidebar and organization selector in place.

Migrated routes:
- \`/admin/platform-security\`: global 2FA policy radio group, loading,
  error/success feedback, and the existing save endpoint.
- \`/admin/notifications\`: booking reminders, ticket idle alerts and
  existing validation limits.
- \`/admin/actions\`: manual AI action review, approval/rejection, input
  preview and status.
- \`/admin/support-teams\`: team creation, member assignment and
  SLA escalation settings.

Primitives: AdminPage, AdminHeader, AdminPanel, AdminButton, AdminNotice,
AdminEmpty, AdminBadge, and a shared form control class.

## Constraints

- Do not change authentication, tenant context, authorization, backend
  endpoints, payloads or routing as part of a visual migration.
- The existing platform \`/admin\` layout remains full-admin-only. This is
  a visual rollout, not a capability or role grant.
- Styling is local to the migrated React components; there are no broad
  CSS overrides of unrelated legacy screens.
- Review responsive layouts and keyboard focus at desktop and phone
  widths. Use \`frontend/tests/admin-design.test.mjs\` and the normal
  Jenkins typecheck, lint, format, build and integration suites.

## Remaining work

Admin settings, analytics, mail, knowledge, employee management, agent
versions, automations, scheduling, integrations and other pages still need
deliberate component-level migrations. Profile and customer portal should
follow only after the admin surface is consistent. Visual QA with real
data remains necessary before claiming the entire product is migrated.
