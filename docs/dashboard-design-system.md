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

Typography: Inter when available, then platform system sans fonts. H1 21–30px; section titles 14px; body 12–13px; chart and list metadata 9–11px. Keep data readable at common display widths. White cards, 14px radius, subtle shadows and consistent gaps define the visual hierarchy.

## Dashboard layout

- Desktop: 264px dark sidebar; 69px workspace toolbar; five KPI tiles; three insight charts; three lists.
- Tablet: KPI grid reduces to three columns; charts and lists stack to two columns.
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

## Limits and follow-up

The reference mockup is a **visual specification**, not a source of example customer names, event counts, dates or ratings. The first rollout updates the employee homepage and its shared sidebar; pre-existing admin settings, editors, profile and portal flows retain their own established UI until they undergo deliberate component-by-component migration.

Before merge: run Jenkins builds, mobile/desktop browser screenshots and keyboard/accessibility checks. Monitor real dashboard performance with representative customer and ticket volumes.
