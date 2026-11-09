# Relvona dashboard design system

This document records the approved employee dashboard redesign. The source of truth is `frontend/src/app/relvona-dashboard.css`, scoped to `.relvona-workspace` / `.relvona-workspace--overview`, and `frontend/src/components/dashboard-tabs/overview-tab.tsx`.

## Visual identity

| Token | Value | Intended usage |
| --- | --- | --- |
| Navy | `#111e32` | Persistent sidebar, brand foundation |
| Royal blue | `#416fed` | Selected navigation, primary KPIs |
| Violet | `#8d65f3` | AI activity, conversation series |
| Sky cyan | `#4dbbed` | Secondary chart categories and pending states |
| Mint | `#3ec2aa` | Resolved state and positive system indicators |
| Text ink | `#101b39` | Headings and primary body text |
| Secondary text | `#667694` | Captions and supporting labels |
| Canvas | `#f7f9fc` | Dashboard background |
| Card border | `#e8edf5` | Soft component separation |

Typography: Inter when available, then platform system sans fonts. H1 21–30px; section titles 14–17px; body 12–14px; chart legends and list metadata at least 12px. Keep data readable at common display widths. White cards, 14px radius, subtle shadows and consistent gaps define the visual hierarchy.

## Dashboard layout

- Desktop: 264px dark sidebar; 69px workspace toolbar; outstanding-work summary; five KPI tiles; three lists; three insight charts.
- Below 1390px: KPI grid reduces to two columns with a compact full-width feedback tile; the ticket list spans both columns, with appointments and activity below it.
- Tablet/phone (<=950px): the entire workspace switches from side-by-side flex rows to a **column layout**, placing navigation above a scrollable dashboard. Without this shell change, a 100%-width sidebar would otherwise push the dashboard off screen.
- Phone: horizontal compact navigation; KPI grid two columns; charts and lists become single column; date filter remains operable. Native form widgets use a light color scheme only on the light dashboard.
- The header notification bell is the **existing functional** notification center; do not replace it with a decorative icon.
- All charts should have meaningful text labels, a data-empty state, and a reduced-motion equivalent. The support-volume graph has a visually hidden table with each UTC day's exact ticket and conversation counts for screen-reader users.
- Real data only. Never fill dashboard KPIs with figures from the UI reference mockup.
- Lazy-loaded views show an appropriately colored dashboard skeleton; missing organization context and API failures have distinct empty/error states.
- After first successful loading, the dashboard refreshes every **60 seconds while the browser tab is visible**, and also on return to the tab. The request is cancellable, background failures leave the last good numbers visible with a warning, and user-requested refresh does not blank the cards. Switching organizations immediately unmounts the old tenant's dashboard before loading the next tenant.

## Data contracts

`GET /api/v1/analytics/dashboard?days=7|30|90` returns tenant-scoped:
- Ticket, conversation and appointment counts for the UTC time window, with equal-length previous-period counts.
- First-response average **only where measured**; positive feedback share **only where feedback exists**.
- Daily UTC counts for tickets and conversations, including zero-filled dates.
- Current all-time ticket status and time-window category distribution (first tag); the `Weitere` group accounts for categories outside the top five.
- Five newest tickets, five confirmed future bookings and five recent, safe-to-display activity types.

The endpoint enforces organization and `analytics.view` access on the server, emits `Cache-Control: private, no-store`, and does not emit fabricated placeholder figures. Access to **ticket subjects/customer names** additionally requires `tickets.view`; access to **guest names and meeting URLs** additionally requires `scheduling.view`. The API returns `access.tickets` and `access.scheduling` so the UI can distinguish an empty list from a lack of permission without disclosing restricted details. Aggregate counts remain available to analytics readers. The "Positive Bewertungen" KPI is **helpful message-feedback votes** (positive / positive + negative), not a standardized customer satisfaction survey result.

The day buckets are based on the repository's UTC-naive PostgreSQL timestamp columns; they deliberately avoid applying `AT TIME ZONE` twice, which can shift values across calendar days on non-UTC database sessions. Future-dated rows are excluded from rolling series. The corresponding integration test is `backend/src/tests/dashboardOverview.integration.test.ts`, executed by the Jenkins-only test runner.

## Unified workspace rollout: tickets, conversations, analytics and people

The modern workspace styling now also covers the other frequently used employee areas:

- `frontend/src/components/dashboard-tabs/workspace-primitives.tsx` defines reusable headers, panels, KPI tiles, and accessible empty states.
- `frontend/src/app/relvona-workspace-sections.css` applies those colors, typography, border radii and spacing only to the explicitly selected `.rv-main--modern` workspaces. Ticket and inbox styles are scoped further to `.rv-ticket-workspace` and `.rv-inbox-layout`; these remain the original functional ticket and conversation handlers.
- Analytics presents the existing server-supplied metrics, AI resolution donut, status bars, language distributions and honest data-empty states. No arbitrary progress values are fabricated from raw knowledge-source counts.
- Customers and Support-Team have searchable responsive lists. Agent presence labels are derived from actual presence data; an absent value is **unknown**, not a fabricated online/active status.
- Tickets support filtering by customer/subject/number and status; selecting a ticket uses a real keyboard-focusable button, not a click-only table row. Status colors are consistent with the home dashboard.
- The Conversation-Inbox preserves the existing assignment, reply, priority and internal-note functionality while gaining modern surfaces, responsive stacked panels, accessible selection and an empty state.
- `frontend/src/app/admin/employees/page.tsx` retains the existing CRUD and consent switches, but the form and employee selector use matching light surfaces and include a search field.
- Backend authorization for all actions remains mandatory; no frontend visibility rule replaces the server's role/permission checks.

The rollout deliberately avoids restyling authentication pages, customer-facing portals and destructive administrative dialogs without separate QA. All changes require frontend Biome formatting, TypeScript validation, browser and keyboard checks, plus Jenkins before merging.

## Knowledge and AI configuration rollout

The same Relvona workbench now extends to the knowledge base, website crawler, AI assistant configuration and organization settings. The existing forms, mutations, worker status polling and permissions are retained.

- `dashboard.tsx` scopes these pages to `.rv-config-workspace` while adding shared `WorkspaceHeader` headings and actual overview metrics for knowledge bases, document sources, indexed chunks, pending processing and crawler activity. No synthetic counts are introduced.
- `knowledge-sources.tsx` retains editing, deletion, reprocessing, security state and processing-job refresh; it adds search by title/type/status, exact status filters, translated badges and an announced filtered count.
- The AI configuration keeps provider profiles, active-profile selection, system prompts and model settings. When no assistant is loaded, it shows an explicit empty state instead of a blank screen. Temperature value `0` is preserved rather than silently replaced with the fallback.
- Organization API-key fields are masked by default, allow explicit reveal, and automatically hide when the organization changes or the user leaves the settings tab. Regeneration now requires confirmation and reports backend errors instead of silently swallowing them. Key rotation invalidates the previous credential and callers must update integrations.
- `frontend/src/app/relvona-workspace-sections.css` defines the corresponding light cards, semantic processing states, accessible form focus rings and responsive metrics. It is scoped to the modern employee workspace so customer-facing and authentication screens are not inadvertently restyled.

The **known CI blocker** is the Jenkins agent's rootless Podman environment: the executor inherits `NoNewPrivs: 1`, preventing `newuidmap` from establishing its namespace. This must be fixed in the actual agent service or launcher by the server administrator. Prior frontend Biome and TypeScript checks also remain to be validated after Jenkins can run. **Do not merge this PR solely because it is conflict-free.**

## UI technical cleanup and display correctness

- Ticket status options, translated labels and safe CSS tones now have a single source in `frontend/src/lib/support-status.ts`; unknown server values remain visible but cannot form arbitrary style classes.
- The analytics AI solution percentage is computed from **distinct `ai_resolved` events**, not the overall RESOLVED conversation state (which can include human-assisted resolutions). No-rate cases show “—”. State percentages use the full conversation count, and unknown detected languages are shown as “Unbekannt”.
- Safe percentages are centralized in `frontend/src/lib/support-metrics.ts`; conversation-state colors remain fixed even when chart ranking changes.
- React lazy-loading placeholders for analytics and directories match the light workspace rather than flashing dark cards; animations stop for reduced-motion users.
- Knowledge-source status refresh now uses one in-flight request, clears pending timeouts when hidden/unmounted and catches transient refresh errors instead of generating unhandled rejections.
- Presentation regressions live in `frontend/tests/support-display.test.mjs`, callable with `npm --prefix frontend run test:ui-utils`, and are included in the Jenkins Podman CI test matrix. Four standalone tests were run successfully with Node 22's type-stripping support; full frontend/browser checks remain outstanding.

### CI diagnostic repairs

The PR Jenkinsfile previously contained an accidentally truncated `NoNewPrivs` shell condition and a duplicated remainder of the pipeline, causing an independent parse failure. This has been repaired. Workspace-only `post` actions are now conditional on a valid Jenkins FilePath so early agent failures are not masked by `archiveArtifacts` errors. These changes **do not** fix the agent service's underlying `NoNewPrivs=1` / `newuidmap` restriction, which remains a separate host-operator prerequisite.

## Code-first workspace decomposition (2 November 2026)

Refactoring was prioritized before test execution, without changing existing backend APIs or triggering deployment:

- `dashboard.tsx` is now primarily responsible for auth/session context, tenant data, navigation, and the ticket/conversation workflow. It was reduced from roughly 146 KB / 3,350 lines to roughly 83 KB / 2,000 lines.
- `dashboard-tabs/organization-settings.tsx`: isolated organization API-key management; revealed keys and pending UI state are discarded when the component unmounts. Rotations have a confirmation and the parent validates the target tenant before applying the response.
- `dashboard-tabs/widget-designer.tsx`: independent appearance controls, true-color preview, hosted page and embed-code management. It reuses the modern light workspace style; key rotation requires confirmation.
- `dashboard-tabs/knowledge-workspaces.tsx`: typed knowledge base and crawler forms, reusing the original handlers and service endpoints.
- `dashboard-tabs/assistant-settings.tsx`: typed model/profile editing, API provider settings and guardrails. This is a presentational extraction; state ownership and backend persistence stay in the dashboard.
- `dashboard-tabs/tickets-workspace.tsx`: typed ticket table and detail panel; search/status filter state is local to the ticket tab. Existing ticket comment/status handlers remain in the parent until the conversation/ticket workflows move to dedicated hooks.
- `lib/dashboard-navigation.ts`: type-safe tab IDs, icon metadata and explicit administrator visibility rules; direct `as any` navigation casts are eliminated.
- Knowledge base and source arrays have explicit TypeScript element types rather than `any[]`.
- Tenant response handling uses per-load epochs and organization identity checks to prevent older requests overwriting current data. Switching tenants also clears ticket details, conversations, search results, knowledge and AI configuration immediately. Ticket detail fetches are similarly guarded.

### Intentionally deferred validation and remaining code debt

As requested, full tests and CI remediation are **not** part of this refactoring pass. TypeScript, Biome and browser validation must still be run and any follow-up errors resolved before merging. The existing Jenkins host service's Rootless-Podman `NoNewPrivs` issue remains separate.

The conversation workflow, ticket/business-action handlers, authentication/login section, and remaining global state inside `dashboard.tsx` are still candidates for extraction into dedicated hooks and components. Their extraction should preserve tenant cancellation, server-side RBAC enforcement, and websocket cleanup rather than merely relocate JSX.

## Conversation-Inbox modularization (code-first continuation)

- `dashboard-tabs/conversations-workspace.tsx`: the original inbox list, filters, assignment, status, internal notes, handoff information, timeline and message composer now live in a standalone typed presentational component. API mutation handlers remain in the parent so existing organization/role context is preserved. The component performs no direct API calls.
- `hooks/use-conversation-realtime.ts`: a dedicated socket lifecycle hook opens a room only for the current authorized organization/conversation, merges and orders messages by ID, and disconnects on conversation change, leaving the inbox, or unmount.
- The parent has explicit `InboxConversation`, `InboxMessage`, `ConversationTag`, `InboxAgent`, `InboxTimelineEvent`, `InboxHandoff`, and `InboxSuggestion` state types instead of untyped arrays.
- Details, translations, internal notes, suggested replies, outgoing agent messages, tag/assignment updates and ticket-to-conversation navigation check the active conversation and organization before applying asynchronous results. A new conversation clears old messages, translations, suggestions and draft fields; refreshing the **same** conversation preserves unsent drafts and deduplicates live messages.
- The inbox search is debounced by 350 ms. Redundant Enter-key refresh requests were removed. Logout invalidates pending tenant requests and clears private conversation, ticket, knowledge, agent and assistant state.
- `dashboard.tsx` now contains approximately 1,600 lines rather than the original 3,350.

**Deferred by request:** do not treat code inspection as TypeScript/formatting/browser verification. No new tests, full CI runs or server-agent changes were performed during this continuation. The new code needs the normal review/verification before merging.

## Limits and follow-up

The reference mockup is a **visual specification**, not a source of example customer names, event counts, dates or ratings. The first rollout updates the employee homepage and its shared sidebar; pre-existing admin settings, editors, profile and portal flows retain their own established UI until they undergo deliberate component-by-component migration.

Before merge: run Jenkins builds, mobile/desktop browser screenshots and keyboard/accessibility checks. Monitor real dashboard performance with representative customer and ticket volumes.

## Dashboard readability and work prioritization (9 November 2026)

- The first overview panel shows outstanding tickets, split into open, in-progress and pending states. These are existing all-time aggregate status counts; the panel explicitly distinguishes them from the selected KPI time window. Ticket navigation requires `access.tickets`. No ticket urgency or priority is inferred from status.
- Recent tickets now precede analytical charts and receive more width and a blue top border. The list remains the five newest tickets; its heading states that scope.
- Metadata and chart legends use at least 12px CSS text; ticket subjects use 14px. The volume chart uses a smaller viewBox and four date labels to improve axis readability on narrow displays.
- Below 1390px, KPIs use two columns with a compact full-width feedback tile. Mobile cards allow labels and long numeric values to wrap.
- Volume changes use a neutral color and signed percentages, rather than treating increasing ticket/conversation/appointment counts as an improvement. Zero changes have no directional arrow.
- Focus outlines cover overview controls. The workload summary wraps for mobile and its ticket action has a 44px minimum height.

Validation: frontend TypeScript and six UI utility tests passed. Browser layout checks use rendered overview markup and compiled project CSS with isolated fixtures (populated, empty and restricted access) at 320, 390, 768, 1024, 1366, 1440 and 1920px. This fixture preview does not exercise authenticated routing, live API calls or the full application shell. The production build passed with `npm run build -- --webpack`; the default Turbopack build is blocked by a local process/port permission error. Existing Biome warnings concern the avatar image and meeting-URL non-null assertion; no lint errors were reported.

## Profile and employee-tab alignment (9 November 2026)

- `dashboard-tabs/profile-workspace.tsx` now owns the profile presentation. The existing controller still owns profile state, upload validation, preference persistence and notifications. `/profile` retains its server session guard and opens the same modern workspace as the profile tab.
- The profile shows an identity/upload card, personal details, appearance controls with a live isolated preview, a save action and separate password/2FA panels. Name, image, language, theme and security API contracts are retained. Inputs have persistent labels; setup, recovery-code and policy messages use light semantic notices. Security forms remain outside the profile preferences form.
- Every dashboard tab now uses the modern light canvas. `WorkspaceToolbar` adds the current section and a functional profile shortcut. Tickets use the shared `WorkspaceHeader`; analytics, customers, team, knowledge, crawler, assistant, widget and organization share larger captions, light inputs and visible keyboard focus.
- Light palette variables are scoped to the modern main element so older global `!important` utility rules cannot turn its cards dark. Sidebar specificity keeps the navy design under both saved theme presets; the matching mobile rule restores full-width navigation. Explicit preview colors continue to come from user-selected state.
- One padding variable drives modern main padding and toolbar edge alignment, avoiding conflicts with legacy mobile padding overrides. At 650px and below, profile forms and security panels stack, and the profile save button spans the available width.

Validation: TypeScript, six UI utility tests and 17 server page-authentication cases passed; changed-file Biome lint reports no errors (existing `any`/image warnings remain). The production build succeeds with Webpack. An isolated browser fixture renders the actual 11 tab components with compiled project styles at 320, 390, 768, 1024, 1366, 1440 and 1920px, checking overflow, palette, navigation width and profile labels. Browser interactions cover profile editing, appearance preview, save callbacks, avatar selection/removal, password mismatch validation, TOTP setup/confirmation and the required-2FA disable guard. Authentication and API boundaries use fixtures; this does not establish live backend or authenticated-routing behavior. A separate static review found no Important/Critical regressions.

This phase covered the employee workspace and its tabs. The remaining routes are covered by the subsequent application rollout below.

## Remaining application pages (9 November 2026)

- `relvona-application.css` scopes the shared light palette, controls, cards, table surfaces and readable semantic colors to the application chrome. The root layout imports it after the legacy interaction styles. It does not replace global user preferences or backend authorization.
- `admin/admin-layout-client.tsx` uses a navy sidebar grouped into work, AI/knowledge, reporting and administration, with active-page links and horizontal mobile navigation. The organization selector still writes `active_org_id` before updating state and remounts children by organization ID. Its initial loading, unavailable and no-organization states have matching light surfaces.
- `/admin` now provides light navigation cards. All standalone admin content inherits the same surfaces, including employees, versions, actions, working hours, teams/SLA, automations, analytics, knowledge, answer quality, scheduling, integrations/Zendesk, mail and security. Settings use compact section links instead of a second sidebar. Shared settings fields have actual labels associated with their input IDs.
- Embedded `/admin/configuration` retains the employee workbench instead of gaining a second sidebar. Its wrapper is excluded from generic application utility restyling; only the outer toolbar carries the application theme. Widget preview text remains white on the user-selected primary color, independently of surrounding surfaces.
- `components/access-shell.tsx` supplies common brand navigation, a navy introduction and a light form card for login/loading, initial setup, invitations, customer portal entry and verification. Introduction content is hidden on small screens. Authenticator login, password constraints, invitation acceptance, bootstrap-token headers and redirect behavior are preserved.
- The signed-in customer portal has a navy identity header and light support, ticket, appointment and memory panels. Appointment selection, rescheduling/cancellation and customer attachment handlers remain connected to the same APIs. Portal fetch callbacks are stable and form buttons have explicit types.
- Dashboard loading and the attachment drawer use matching surfaces. The attachment backdrop is a separate close button, so clicks inside the drawer do not close it. The notification bell is hidden on access/loading screens.

Validation: six existing UI utility tests, 17 page-authentication cases and TypeScript passed. Changed-file Biome lint reports no errors; legacy warnings remain. The production build passes with Webpack. Browser QA renders actual components with compiled project styles and isolated API/router fixtures: 26 admin states and five public/portal pages at 320, 390, 768, 1024, 1440 and 1920px. It checks page overflow, navigation widths, organization selection and page-state remounting, settings labels, login submission, setup password mismatch, invitation submission, portal email-link requests, booking-slot/attachment display, error retry and embedded widget-preview colors. Completed setup, invalid invitation and unavailable-admin states are checked separately. These fixtures do not establish live backend behavior, email delivery, server routing or production authentication. A separate static review identified a preview-color overlap; theme isolation and a computed-color browser assertion verify its correction. No deployment or merge was performed.
