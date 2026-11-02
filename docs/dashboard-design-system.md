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
- All charts should have meaningful text labels, a data-empty state, and a reduced-motion equivalent.
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

The endpoint enforces organization and `analytics.view` access on the server and does not emit fabricated placeholder figures. Access to **ticket subjects/customer names** additionally requires `tickets.view`; access to **guest names and meeting URLs** additionally requires `scheduling.view`. The API returns `access.tickets` and `access.scheduling` so the UI can distinguish an empty list from a lack of permission without disclosing restricted details. Aggregate counts remain available to analytics readers. The "Positive Bewertungen" KPI is **helpful message-feedback votes** (positive / positive + negative), not a standardized customer satisfaction survey result.

The day buckets are based on the repository's UTC-naive PostgreSQL timestamp columns; they deliberately avoid applying `AT TIME ZONE` twice, which can shift values across calendar days on non-UTC database sessions. Future-dated rows are excluded from rolling series. The corresponding integration test is `backend/src/tests/dashboardOverview.integration.test.ts`, executed by the Jenkins-only test runner.

## Limits and follow-up

The reference mockup is a **visual specification**, not a source of example customer names, event counts, dates or ratings. The first rollout updates the employee homepage and its shared sidebar; pre-existing admin settings, editors, profile and portal flows retain their own established UI until they undergo deliberate component-by-component migration.

Before merge: run Jenkins builds, mobile/desktop browser screenshots and keyboard/accessibility checks. Monitor real dashboard performance with representative customer and ticket volumes.
