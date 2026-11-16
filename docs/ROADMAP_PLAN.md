# Patchwork v1.0.0 Roadmap Plan & Step 0 Verification

This document records the Step 0 codebase verification for the `v1.0.0` public roadmap (`docs-site/src/data/roadmap.yaml`).

## 1. Step 0 Codebase Verification Results

1. **Slash command `/link` conflict**:
   - Checked `src/lib/commands/registry.ts`. `/link` is already registered (`name: "link"`, `Attach a GitHub/GitLab URL to a ticket`).
   - **Action**: Ticket dependencies and subtasks cannot use `/link`. The roadmap states "command name to be decided" and does not claim `/link`.
2. **Ticket due dates and Calendar view already exist in `v0.7.0-beta`**:
   - Checked `src/db/schema.ts`: `tickets.dueDate` (`due_date`) already exists.
   - Checked `src/lib/commands/registry.ts`: `/due` slash command already exists.
   - Checked `src/components/BoardCalendarView.tsx`: Board Calendar view already exists (`Board` vs. `Calendar` toggle).
   - **Action**: `ticket-due-dates` and `calendar-view` are **not** listed as planned prerequisites because they are already implemented in `v0.7.0-beta`.
3. **Activity history table and SSE channel**:
   - Checked `src/db/schema.ts`: activity history is stored in `ticket_activities` (`ticketActivities`).
   - Checked `src/app/api/events/route.ts`: SSE updates stream from `/api/events` via `realtimeHub` (PostgreSQL `LISTEN/NOTIFY`).
   - **Action**: Roadmap summaries refer to these generically ("existing activity history", "existing real-time update channel").
4. **System Configuration existing capabilities**:
   - Checked `src/components/system/DataBackupSection.tsx`: provides JSON/CSV data export and native backup command instructions only (no scheduled backups, restore UI, or verification status).
   - Checked `src/components/system/HealthDiagnosticsSection.tsx`: provides live PostgreSQL/MinIO/migration checks and diagnostics export.
   - Checked `src/components/system/SecuritySection.tsx`: provides password policy, session lifetime, idle timeout, and login rate-limit settings (no 2FA/TOTP, passkeys, SSO, or audit log).
   - Checked `src/components/system/IntegrationsSection.tsx`: provides GitHub/GitLab forge host allowlist, encrypted forge token, and link metadata cache TTL (no inbound/outbound webhooks or personal API tokens).

## 2. Open Design Decisions (Marked "details to be decided" / "to be decided")

- Slash command names for **Ticket dependencies and subtasks** and **Ticket watchers** (cannot reuse `/link`).
- Background worker scheduling/execution details for **Ticket templates and recurring tickets**.
- Webhook signing/delivery and SMTP configuration details for **Outbound email and webhook alerts** and **Inbound GitHub and GitLab webhooks**.
- Intake bridge authentication and routing details for **Email-to-ticket and public intake form**.
