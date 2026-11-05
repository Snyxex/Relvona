# Support automation: administrator guide

Relvona supports organization-scoped ticket automation. This guide describes the existing feature and a conservative rollout workflow for organization owners and administrators.

## Where to manage rules

Open `/admin/support-automations` in the Relvona dashboard. The page is limited to organization owners and administrators. Keep rules disabled until their behavior has been reviewed with the simulation (dry-run) feature.

Each rule belongs to an organization. Do not reuse rule configuration, ticket identifiers, or administration credentials across organizations.

## Events, conditions, and actions

| Element | Supported behavior |
| --- | --- |
| `ticket.created` | Evaluate a rule when a new ticket is created |
| `ticket.updated` | Evaluate a rule when a ticket changes |
| `ticket.idle` | Evaluate a rule during the scheduled idle-ticket sweep |
| Conditions | Priority, status, tags, subject keyword, and unassigned state |
| Condition combination | All configured conditions must match (AND) |
| Actions | Change priority (including SLA update), assign an eligible active agent to an unassigned ticket, add a tag, or notify administrators within Relvona |

Rules are intentionally bounded. They are **not** general-purpose scripts, arbitrary HTTP requests, or external webhook executors.

## Recommended rollout

1. Identify a narrow operational case, such as tagging new unassigned requests that mention a particular product.
2. Create a rule with the smallest useful set of conditions. Leave it **disabled**.
3. Review the intended action and its possible interaction with other enabled rules. In particular, priority changes can affect SLA deadlines.
4. Use the built-in simulation/dry-run on representative tickets, including a nonmatching ticket and a ticket that already has an assigned agent.
5. Review the result with another owner or administrator before enabling the rule.
6. Enable the rule for the intended organization and monitor execution history and ticket changes.
7. If results are unexpected, disable the rule, investigate history, and correct the configuration before re-enabling it.

Dry-run is a preview, not proof that every future event will behave identically. Production behavior also depends on the ticket's current state and agent eligibility.

## Operational safeguards

- **Tenant isolation:** Rules, execution records, and their data are scoped to the organization. The implementation uses PostgreSQL row-level security.
- **Replay protection:** Execution history uses unique idempotency keys so duplicate delivery of the same logical event is not intended to repeat the same automation.
- **Recursion prevention:** Events originating from automation execution are not fed back into rules as a new recursive automation trigger.
- **Assignment safety:** An assignment action is restricted to an unassigned ticket and an active staff member; do not treat automation as an override of staff availability or authorization policies.
- **Auditability:** Consult the execution history before editing a rule that appears not to run.
- **Least privilege:** Only owners and administrators should configure rules. Do not expose the configuration interface to agents or customers.

These are implementation safeguards, not a guarantee of exactly-once delivery across all external systems. Do not build financial, legal, or irreversible external actions on top of ticket automation without a separately reviewed execution and approval design.

## Example rule patterns

### Triage newly created tickets

- Event: `ticket.created`
- Conditions: unassigned, plus a specific subject keyword if appropriate
- Action: add an internal categorization tag

Choose a tag that is already part of your team's naming conventions. Confirm the preview matches the expected ticket before enabling.

### Flag high-priority idle tickets

- Event: `ticket.idle`
- Conditions: high priority and the relevant ticket status
- Action: notify administrators within Relvona

The idle evaluator runs on a schedule. Do not assume instantaneous execution or a specific sweep interval without checking the deployed worker configuration.

### Assign unowned tickets

- Event: `ticket.created` or `ticket.updated`
- Conditions: unassigned plus a scoped priority/status filter
- Action: assign an active eligible agent

Verify that assignment cannot conflict with the working-hours, absence, and team-routing workflows configured for the organization.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Rule never executes | Enabled state, event type, tenant, matching conditions, and worker/scheduler status for idle events |
| Rule matches nothing | AND-condition combinations, ticket status, existing tags, and subject keyword |
| Assignment does not occur | Whether the ticket is already assigned and whether the intended staff member is active/eligible |
| Expected duplicate is not repeated | Inspect idempotency history; replay prevention is intentional |
| Ticket change does not trigger another rule | Automation-origin recursion is intentionally blocked |
| Unexpected SLA change | Check priority-change actions and inspect the ticket's SLA history |

Do not delete execution history to force a retry, disable tenant isolation, or manually update database records as an operational workaround.

## Change management and verification

For rule changes, document the purpose, owner, expected matches, simulation result, time of activation, and rollback (disable) decision. Review execution history after rollout. If test infrastructure is unavailable, keep unverified rule changes disabled instead of assuming they are safe.

For developers: changes to rule evaluation, event ingestion, or execution history need tenant-isolation, idempotency, recursion, and role-authorization coverage before release. See [Contributing](../CONTRIBUTING.md) and [Security](security.md).
