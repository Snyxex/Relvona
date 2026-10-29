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
- Phone: horizontal compact navigation; KPI grid two columns; charts and lists become single column; date filter remains operable.
- The header notification bell is the **existing functional** notification center; do not replace it with a decorative icon.
- All charts should have meaningful text labels, a data-empty state, and a reduced-motion equivalent.
- Real data only. Never fill dashboard KPIs with figures from the UI reference mockup.

## Data contracts

`GET /api/v1/analytics/dashboard?days=7|30|90` returns tenant-scoped:
- Ticket, conversation and appointment counts for the UTC time window, with equal-length previous-period counts.
- First-response average **only where measured**; positive feedback share **only where feedback exists**.
- Daily UTC counts for tickets and conversations, including zero-filled dates.
- Current all-time ticket status and time-window category distribution (first tag); the `Weitere` group accounts for categories outside the top five.
- Five newest tickets, five confirmed future bookings and five recent, safe-to-display activity types.

The endpoint enforces organization and `analytics.view` access on the server and does not emit fabricated placeholder figures. The corresponding integration test is `backend/src/tests/dashboardOverview.integration.test.ts`, executed by the Jenkins-only test runner.

## Limits and follow-up

The reference mockup is a **visual specification**, not a source of example customer names, event counts, dates or ratings. The first rollout updates the employee homepage and its shared sidebar; pre-existing admin settings, editors, profile and portal flows retain their own established UI until they undergo deliberate component-by-component migration.

Before merge: run Jenkins builds, mobile/desktop browser screenshots and keyboard/accessibility checks. Monitor real dashboard performance with representative customer and ticket volumes.
