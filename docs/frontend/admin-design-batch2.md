# Admin design migration — batch 2

This stacked PR builds upon PR #75 and adopts its shared
\`frontend/src/components/admin/admin-ui.tsx\` primitives. It migrates two
remaining standalone administrative pages to the established light palette.

- \`/admin/answer-quality\`: consistent header, evidence-selection panel,
  preview action, feedback and result presentation. Keeps manual verification,
  the 30-source limit, source IDs and existing API request intact.
- \`/admin/mail-server\`: consistent header, SMTP settings panel, form controls,
  loading state and test/save buttons. Keeps password redaction, TLS choices,
  endpoint paths, request payloads and existing validation.

This is only a presentation refactor. No backend, auth, organization-scoping,
role, or database changes. Neither page is exposed to delegated operators.

Verification: UI smoke/contract tests are registered automatically through
\`frontend/tests/*.test.mjs\`; Jenkins must still pass TypeScript, Biome and
the complete security/integration suites. The review should additionally
verify responsive layouts, focus order and correct feedback in the browser.

**Dependency:** merge PR #75 first, then retarget this PR to \`main\` after
its shared design primitives are available there. Until then, this is a
stacked draft PR.
