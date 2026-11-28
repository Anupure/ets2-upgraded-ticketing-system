# Product Roadmap

> Status: Living roadmap; priorities reflect the current agreed direction.
> Last updated: 2026-11-28

## Guiding approach

Deliver the single-tenant ETS2 experience in usable increments. Preserve the future multi-tenant SaaS direction in the requirements and architecture, but do not let speculative billing or tenant automation delay the core journey experience.

The product requirements are in [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md). Update that document when decisions change; update this roadmap when priorities or delivery phases change.

## Current known state

- PR #14 (home navigation and operator onboarding foundation) was merged into `master` on 2026-11-28. The project owner locally validated typecheck, unit/integration tests, production build, and Playwright checks; GitHub Actions validation also succeeded for the final PR head.

Previously validated by the project owner:
- Test suite: 31 tests passed across 10 files using `npm test -- --maxWorkers=1`.
- TypeScript typecheck passed.
- Production build passed after regenerating Prisma client.
- Playwright smoke tests: 3 passed.
- Existing smoke coverage includes public landing page, operator authorization protection, and anonymous API rejection.
- Full passenger booking browser E2E and full journey lifecycle browser E2E remain incomplete.
- Security dependency upgrades were deliberately deferred while end-to-end functionality is prioritized.
- Do not infer that open PRs are merged. As of this roadmap update, PR #11 and PR #12 are open; PR #12 is stacked on PR #11 and requires PR #11 to merge first, then PR #12 to be retargeted to master.

## Phase 0 — Stabilize current work

- Review and complete PR #11: passenger pickup/drop labels and route timeline.
- Review and complete PR #12: left-hand-drive, coach-shaped 2+2 seat selection map.
- Validate seat map visually and against actual persisted seat row/column data.
- Preserve segment-aware seat availability and existing booking API behaviour.
- Reconfirm tests, typecheck, build, and browser smoke tests after integration.
- Do not merge pull requests without explicit project-owner authorization.

## Phase 1 — Home page, navigation, and operational foundation (next priority)

**Status:** Navigation/onboarding foundation is delivered by merged PR #14. The central Operator Control Room remains the next major Phase 1 deliverable.

1. Make the home page a clear navigation hub for passenger and driver/operator workflows.
2. Add direct links to all relevant pages and role-appropriate entry points.
3. Make driver onboarding discoverable from the home page.
4. Separate onboarding completion from operator authorization.
5. Clarify journey management entry points and operator access state.
6. Build the central operational dashboard around active journey status, capacity, manifest, boarding/deboarding, route progress, and alerts.
7. Keep secondary controls in focused pages/panels rather than overcrowding the dashboard.
8. Add or improve tests for navigation, role-gated routes, and operator authorization.

**Acceptance direction**
- A user can reach the relevant passenger and operator pages from the home page.
- A driver can find onboarding without needing a hidden URL.
- An onboarded but unauthorized user cannot operate a journey.
- Unauthorized API calls remain rejected.
- Dashboard state is based on server data and remains correct after refresh.

## Phase 2 — Passenger identity and profile experience

1. Permanent immutable User ID.
2. First-login profile completion.
3. Unique username with server-side validation.
4. Curated free avatar selection.
5. Global user directory for Platform Owner.
6. Platform-level role management, restricted to Platform Owner.
7. Tenant membership/role concepts kept separate from global roles.
8. Show username/avatar in permitted tickets and coach seat map.
9. Keep private account details out of public views.

## Phase 3 — Journey operations

1. Scheduled mandatory breaks at operator-selected rest stops.
2. Passenger Pit Pass requests and queue.
3. Driver-initiated discretionary breaks.
4. Server-authoritative break timers, overtime, configurable grace period, explicit left-behind decision.
5. Transactional concurrency protection and token accounting.
6. Simple onboard snack/drink/meal availability and passenger requests.
7. Driver/attendant fulfilment workflow.
8. Predefined and custom announcements.
9. Passenger assistance queue (luggage, medical, boarding help, general).
10. Operational incident logging and passenger-safe notifications.
11. Manual journey progress and delay updates.

## Phase 4 — Live passenger and broadcast experience

1. Reliable live updates (SSE or suitable alternative) with refresh/reconnect recovery.
2. Passenger live journey status.
3. Public-safe OBS overlay and dedicated data contract.
4. Live coach seat map with privacy-safe identity.
5. Selected break and announcement notifications for OBS.
6. Full lifecycle E2E coverage.
7. Concurrency tests for booking and break workflows.
8. Offline/reconnect and timer restoration tests.
9. Operator and passenger experience verification.

## Phase 5 — Multi-tenant SaaS foundation (future)

1. Platform Owner global admin dashboard.
2. Global user directory and platform role controls.
3. Tenant entity and tenant membership model.
4. Manual tenant creation and approval by Platform Owner only.
5. Assign first Tenant Owner.
6. Tenant-scoped conductor and operator management.
7. Temporary journey/event permissions.
8. Strict tenant data isolation across database queries, APIs, events, and files.
9. Tenant-specific branding/configuration.
10. Fixed platform-controlled subdomain routing.
11. Tenant usage and administration tools.
12. Explicit prevention of tenant creation/resale by Tenant Owners.

**Important:** Do not implement the complete tenant schema before the single-tenant product requirements and core flows are stable. Before adding tenant tables/columns, inspect the current schema and design a migration plan that preserves existing data and test/production database safeguards.

## Phase 6 — Tenant application, billing, and automated provisioning (future)

### Manual first
- Tenant application form.
- Desired display name and unique subdomain slug request.
- Application review by Platform Owner.
- Manual pricing/payment instructions and payment verification.
- Manual tenant provisioning, owner assignment, and activation.

### Automation later
- Plan/quote and checkout.
- Payment provider integration and trusted webhook processing.
- Automated tenant provisioning and subdomain activation.
- SSL/TLS issuance, renewal, and certificate health checks.
- Subscription lifecycle, failed-payment retries, grace period, suspension/deactivation, and reactivation.
- Billing notifications, invoices/receipts, audit history, and admin override.

Pricing, provider, tax handling, plan tiers, grace periods, retention, disputes, and commercial terms are not decided.

## Feature request intake and phase discipline

- Treat new ideas, requested changes, screenshots, and reminders from the project owner as product backlog input, not automatic instructions to implement immediately.
- For every suggestion, first map it to an existing requirement and its appropriate roadmap phase.
- If it belongs to a later phase, record it in that phase (or add it there if missing), tell the project owner where it is planned, and defer implementation until that phase.
- If it belongs to the current phase, assess dependencies and acceptance criteria before implementing.
- If the request changes an existing product decision or introduces a conflict, surface the conflict and ask for a decision rather than silently changing scope.
- Keep the requirements and roadmap as the source of truth so ideas raised early are not lost.

## Cross-cutting quality gates

- Server-side authorization for every privileged operation.
- No cross-tenant data leakage once multi-tenancy exists.
- Immutable IDs; usernames remain mutable display identifiers.
- No private passenger details in public/OBS responses.
- Transactional seat allocation, token spending, and break state transitions.
- Server-authoritative timers and persisted lifecycle state.
- Explicit audit events for privileged actions and operational decisions.
- Tests must cover success, unauthorized access, invalid transitions, duplicate requests, and concurrency.
- Keep production database safeguards; do not reset or destructively mutate production data.
- Do not silently expand scope into cancellation/refund workflows.
- Security dependency hardening remains deferred until the project owner reprioritizes it.

## Decision log

- 2026-11-28: Home page/navigation and central operational dashboard are the immediate next product priority, before passenger profiling.
- 2026-11-28: Platform Owner exclusively creates/approves tenants and appoints initial Tenant Owners in the initial SaaS model.
- 2026-11-28: Future tenant application may allow a requested name and fixed-domain subdomain slug, subject to availability validation.
- 2026-11-28: Initial tenant activation/payment verification is manual; automated billing/provisioning is a later phase.
- 2026-11-28: Future tenant service must prevent Tenant Owners from reselling, sublicensing, or creating sub-tenants.
- 2026-11-28: SSL/TLS certificate issuance, renewal, and health checks are required considerations for future automated custom/subdomain provisioning.
- 2026-11-28: No cancellation/refund workflow under current product direction.

- 2026-11-28: Project owner requested strict phase discipline: new ideas are to be mapped to the correct roadmap phase and documented immediately; defer implementation when they belong to a later phase, and explicitly tell the owner where they are planned.
