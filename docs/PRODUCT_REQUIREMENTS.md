# Product Requirements

> Status: Working product specification
> Last updated: 2026-11-28
> Purpose: Preserve agreed product direction and implementation constraints. This document is not a statement that every feature is implemented.

## 1. Product vision

Build a reliable, interactive ticketing and journey-operations platform initially used for ETS2 streamer/community journeys, with a future path to a multi-tenant SaaS offering for streamers, YouTubers, event organizers, and other communities.

The platform should support:
- Passenger discovery, booking, seat selection, and journey participation.
- Driver/conductor tools for running journeys.
- A live operational dashboard and public-safe OBS experience.
- A central platform owner who controls users, permissions, and (later) customer tenants.
- Independent customer workspaces in a future SaaS version.

## 2. Product principles and boundaries

1. Build the single-tenant ETS2 experience first; design new boundaries so future multi-tenancy is possible.
2. Separate authentication, profile identity, platform roles, tenant membership, and journey-specific assignments.
3. Enforce authorization on the server/API and at data-access boundaries. Hiding a button is not authorization.
4. Keep private passenger data out of public pages and OBS overlays.
5. Use server-authoritative state for operational timers and lifecycle transitions.
6. Protect seat allocation, token spending, and break state transitions against concurrent requests.
7. Do not implement cancellation or refund workflows unless product direction changes.
8. Do not introduce paid subscriptions, payment automation, GPS tracking, or custom-domain automation in the initial phases.
9. Keep current production/test database safeguards. Never use destructive schema or reset commands against production data.

## 3. Identity, profiles, and user directory

### 3.1 Account identity
- Google authentication remains the current sign-in approach unless deliberately changed later.
- Every account must have a permanent, immutable internal User ID (UUID or equivalent).
- Usernames are public-facing identifiers and may change under controlled rules; they must not be used as database identity or foreign keys.
- Usernames must be unique within the intended platform scope and validated server-side.
- A user may belong to more than one tenant in the future and may hold different roles in each tenant.
- Do not expose Google display name, email, phone number, internal IDs, or private notes on public/OBS views.

### 3.2 Profile setup
- First-time users without a completed profile are directed through profile setup.
- Profile includes a unique username and selected avatar.
- Provide a curated free avatar collection initially; paid/premium avatar packs are a possible future commercial feature, not an initial requirement.
- Apply a username-change cooldown/rules after the policy is decided.
- Profile identity may appear on tickets, seat maps, manifests, and approved public overlays, subject to privacy rules.

### 3.3 Global user directory
A future Platform Owner dashboard should list all registered users across the platform, including:
- Immutable User ID
- Username and avatar
- Account creation date
- Account status (active/suspended/disabled)
- Global platform role
- Tenant memberships and tenant-specific roles
- Relevant audit history for administrative role changes

The directory should support searching by User ID and username. Email may be available to authorized platform administrators only.

## 4. Authorization and role management

### 4.1 Separate role scopes
Do not use one overloaded role field for every permission.

**Platform scope**
- Platform Owner / Super Admin: the platform creator; full control of platform settings, users, tenants, and tenant-owner assignments.
- Standard User: ordinary registered account.
- Suspended/Disabled: account access restricted according to the suspension policy.

Only the Platform Owner may grant or revoke platform-level administrative privileges and create/approve tenants in the initial business model.

**Tenant scope (future SaaS)**
- Tenant Owner: manages one tenant's workspace and operations.
- Tenant Admin: manages explicitly delegated tenant operations.
- Conductor/Operator: operates assigned journeys and approved operational tools.
- Passenger: books and participates in journeys.

A Tenant Owner cannot grant themselves Platform Owner privileges, create another tenant, transfer ownership outside allowed platform rules, or resell/white-label/resubscribe the service to another party.

### 4.2 Journey-scoped temporary access
- A registered user may be assigned conductor/operator access for a specific journey or event.
- Assignment should identify the user, tenant (when available), journey, granted permissions, grantor, start time, expiry time, and revocation time/reason.
- Temporary assignments expire automatically at the configured time.
- Platform Owner can grant and revoke access.
- Tenant Owners may later manage conductors only inside their own tenant and within permissions granted by the platform.
- Completing driver onboarding must not automatically grant operational authorization.

### 4.3 Security and audit
- All privileged actions must be authorized server-side.
- Record who granted, changed, or revoked a role/assignment and when.
- Prevent privilege escalation by checking role scope and grantor authority.
- Apply tenant scoping to every relevant query and mutation in the SaaS phase.
- Avoid trusting tenant IDs supplied by the browser without checking membership and authorization.

## 5. Home page, navigation, and operational dashboard (Phase 1 priority)

### 5.1 Home page as navigation hub
The home page must provide obvious navigation to the major areas rather than forcing users to discover routes manually.

Expected entry points:
- Passenger: find journeys, book seats, view current/upcoming bookings, journey history.
- Driver/operator: onboarding, authorization status, journey management, operational dashboard.
- Live experience: public/live bus map and OBS overlay where permitted.
- Account: profile/settings and help.

Only show actions a user is authorized to access, but ensure the driver onboarding route is discoverable. Onboarding and authorization are separate states.

### 5.2 Driver onboarding and authorization
- Explain how to become an operator/conductor.
- Show application/onboarding status and assigned permissions.
- Do not automatically grant journey control merely because onboarding is complete.
- Only an authorized administrator can grant operational access.

### 5.3 Journey management
Support the operator workflow for:
- Creating and configuring a journey.
- Route, ordered stops, segments, origin/destination, capacity and seat layout.
- Assigning authorized operators.
- Configuring mandatory scheduled breaks at selected rest stops.
- Reviewing journey status and operational history.
- At each stop, require the operator to resolve every passenger action due there before departure.
- For a passenger due to board: confirm physically boarded when checked in, or explicitly mark no-show when the passenger has not checked in.
- For a passenger due to disembark: explicitly confirm disembarked.
- Block departure server-side and transactionally while any due boarding or disembarking action remains unresolved; provide actionable pending-passenger feedback in the operator UI.

### 5.4 Central operator dashboard
The dashboard is the operational control centre, not just a ticket list.

Candidate dashboard modules:
- Journey name/status, origin/destination, current/next stop, scheduled vs actual progress.
- Passenger count, capacity, available seats, and pending alerts.
- Passenger manifest and boarding/deboarding state.
- Live coach seat map.
- Break requests and active break state.
- Announcements.
- Passenger assistance queue.
- Food/snack/meals availability and requests.
- Operational incidents.
- OBS connection/status and public-safe event preview.

Keep the primary view focused. Less frequently used configuration can live in dedicated pages or panels.

## 6. Passenger booking, route and seat experience

- Preserve segment-aware seat availability: a seat may be occupied on one route segment and available on a later non-overlapping segment.
- Seat selection should use a coach-shaped 2+2 map with a central aisle.
- ETS2 coach steering wheel/cockpit is at the front-left (left-hand-drive layout).
- Show booked passenger username/avatar on permitted seat-map views.
- Driver/operator sees the full authorized manifest.
- Passenger sees their own booking/seat and a simplified public-safe view.
- OBS receives a separate public-safe representation.
- Do not expose email, phone, internal ticket IDs, private notes, or other sensitive account data on public displays.
- Maintain booking correctness under concurrent seat selection/booking.
- Cancellation and refund workflows are out of scope by current direction.

## 7. Journey break system

There are three distinct break types. They may share underlying lifecycle infrastructure but must remain distinguishable in records, permissions, UI, and analytics.

### 7.1 Mandatory scheduled breaks
- Operator configures selected rest stops and break durations.
- Not every route stop is automatically a break.
- These are part of the journey schedule and do not consume passenger tokens.
- Passengers can view the planned break schedule.
- Driver can manage/record the actual start and end.

### 7.2 Passenger-requested breaks (working name: Pit Passes)
- Initial proposed allowance: two Pit Passes per passenger per journey. This is a recommended default pending final configuration.
- A passenger can request a break; the request appears to the driver/operator.
- Only one passenger-requested break may be active globally at a time; other requests queue.
- Prevent duplicate requests and token overspending.
- Proposed token-consumption point: when the driver actually starts the approved break, not when the passenger submits a request.
- Driver chooses a safe location and explicitly starts the stop.
- The maximum two-minute break timer begins only when the driver starts the break.
- Passenger can indicate “I'm Back”; driver confirms return/boarding before timer ends.

### 7.3 Driver-initiated discretionary breaks
- Driver may initiate a discretionary break independently or approve a passenger request.
- These events must be distinguishable from scheduled breaks and passenger Pit Passes.
- Driver authority and any duration rules should be configurable.

### 7.4 Overtime, grace, and left-behind handling
- When the two-minute timer expires, mark the break overtime and begin a grace period.
- Proposed initial grace period: 30 seconds; keep configurable rather than hard-coded.
- At grace expiry, require an explicit driver decision: confirm passenger returned or mark passenger LEFT BEHIND.
- Never automatically mark a passenger LEFT BEHIND solely because a timer expired.
- If explicitly left behind, end that passenger's journey at that stop and show an explanatory passenger-facing message.
- Preserve an auditable event history.

### 7.5 Reliability and concurrency
- Persist break state and timestamps on the server.
- Timer display is derived from server timestamps, not a browser-only countdown.
- Refresh/reconnect must restore the active break state.
- Use transactional/concurrency-safe transitions to ensure only one active passenger Pit Stop globally.
- Driver actions from multiple devices must not start conflicting active breaks.
- Validate permissions and token balances in the same authoritative transaction as the state transition.

## 8. Onboard services: snacks, drinks, and meals

Initial scope should be deliberately simple; this is not a full restaurant POS.

Potential capabilities:
- Driver or assigned attendant manages service availability.
- Items may include water, tea/coffee, snacks, lunch, and dinner.
- Availability states: available, low stock, unavailable.
- Meal service states: not started, available, completed.
- Passengers can view availability and submit requests/orders.
- Pre-ordering meals may be supported later.
- Driver/attendant can acknowledge and fulfil requests.
- Exact catalogue, prices, inventory accounting, payment, and ordering rules remain to be brainstormed.

## 9. Announcements and passenger assistance

### 9.1 Announcements
- Support predefined and custom announcements.
- Candidate templates: departing shortly, boarding closing, next stop, scheduled rest stop, lunch/dinner break, Pit Stop, delay, route change, journey completion.
- Passenger UI receives relevant announcements.
- OBS receives only selected public-safe announcements.

### 9.2 Passenger assistance
- Passengers can request help for luggage, medical assistance, boarding-point help, or general assistance.
- Driver/operator sees a queue with acknowledge and complete states.
- Emergency requests must be visually and operationally distinct from routine assistance.
- Define emergency handling and disclaimers before implementation; this system must not be represented as a replacement for emergency services.

## 10. Journey progress and incidents

### 10.1 Journey progress
- Track scheduled vs actual departure, current stop, next stop, delays, pause/resume, and manual status updates.
- Manual operator updates are the initial source of truth.
- Do not display precise live GPS location or accurate ETA until a real location/ETA integration exists and its limitations are clear.
- GPS/live tracking is a later capability; do not block Phase 1 on it.

### 10.2 Operational incidents
Potential incident types:
- Vehicle/coach breakdown.
- Route diversion or road closure.
- Passenger absent or left behind.
- Unexpected stop.
- Delay or operational disruption.

Each incident should capture timestamp, actor, type, description, status, and relevant journey/passenger references. Passenger and OBS visibility must be explicitly controlled per incident type.

## 11. Live experience and OBS

- Provide real-time or near-real-time updates for operator and passenger views.
- OBS overlay is read-only and receives a dedicated public-safe data contract.
- Never reuse a privileged operator API response directly for OBS.
- Public events may include selected journey status, seat occupancy/username/avatar, announcements, and approved break notifications.
- Do not publish private contact details, account email, internal IDs, or private operator notes.
- Consider SSE or another suitable push mechanism for live updates; retain a safe refresh/reconnect fallback.
- Ensure refresh/reconnect restores the correct current state.

## 12. Future multi-tenant SaaS model

### 12.1 Tenant model
A tenant is an isolated workspace for a streamer, YouTuber, event organizer, or other customer.

Each tenant may have its own:
- Branding and display settings.
- Passenger directory and profiles.
- Journeys, routes, seat maps, bookings, and operational records.
- Tenant Owner, Admins, and Conductors.
- Operator dashboard and OBS configuration.
- Service catalogue and tenant settings.

Users may participate in multiple tenants with different tenant-specific roles.

### 12.2 Tenant creation policy
**Initial policy: manual and Platform-Owner controlled.**
- Only the Platform Owner creates/approves tenants and appoints the first Tenant Owner.
- Tenant Owners cannot create tenants or resell, sublicense, or repackage the service.
- Future self-service applications and automated provisioning may be introduced after payment and operational rules are defined.

### 12.3 Future tenant application and subdomain selection
A future public application flow may collect:
- Applicant's name and contact details.
- Requested tenant/display name.
- Desired subdomain slug (example: `ets2grinder`).
- Business/community/streamer details and intended use.
- Requested features, campaign duration, and other information still to be defined.

The platform should:
- Validate slug format and reserve/check uniqueness.
- Use a fixed platform-controlled domain suffix (final domain not selected), e.g. `ets2grinder.<platform-domain>`.
- Prevent applicants from choosing arbitrary external domains in the initial model.
- Avoid exposing or storing passwords in plaintext. Account access should use the platform's supported authentication/invitation flow; if credentials are required, use secure password setup/reset mechanisms.
- Present a quote/payment step only after pricing and commercial terms are defined.
- Keep application, payment, approval, provisioning, and activation as separate states.

### 12.4 Manual provisioning MVP (future, after core product)
- Applicant submits the request form.
- Platform Owner reviews details and slug availability.
- Platform Owner confirms pricing and payment instructions.
- Payment is verified manually.
- Platform Owner approves and provisions the tenant and appoints its owner.
- Tenant is activated manually.
- Keep an audit trail of application review, payment verification, provisioning, and activation.

### 12.5 Automated billing and provisioning (later)
Possible future flow:
- Application and slug validation.
- Quote/plan selection and checkout.
- Payment-provider confirmation/webhook.
- Tenant provisioning and subdomain activation.
- SSL/TLS certificate issuance and automated renewal/health checks.
- Subscription status monitoring.
- Automatic suspension/deactivation after a defined failed-payment/grace policy.
- Reactivation after successful payment.
- Notifications before suspension and after activation.
- Platform Owner override and audit history.

Do not automatically deactivate a tenant based on an unverified browser callback. Payment state must come from trusted provider events and server-side reconciliation. Define grace periods, retries, refunds, disputes, and data-retention behaviour before enabling automatic suspension. Billing provider, prices, plans, taxes, and commercial terms are undecided.

### 12.6 Tenant isolation and non-resale
- Every tenant-owned record must be scoped to its tenant.
- Enforce tenant access in server-side authorization and data access, not only route/subdomain filtering.
- Prevent cross-tenant reads, writes, exports, and live-event leakage.
- Platform Owner can inspect/manage all tenants.
- Tenant Owner can manage only their own tenant and delegated resources.
- Tenant Owner cannot create sub-tenants or transfer the service for resale.
- Custom domains, branding depth, and licensing terms remain future decisions.

## 13. Explicitly deferred / undecided
- Automated billing, payment provider, subscriptions, plans, taxes, and pricing.
- Self-service tenant activation and automated tenant provisioning.
- Final platform domain and subdomain policy details.
- SSL certificate provider and operational automation.
- GPS tracking and precise live ETA.
- Premium avatar packs and paid add-ons.
- Full POS, stock accounting, and payment for onboard food.
- Final Pit Pass allowance and grace-period configuration.
- Final emergency-assistance workflow.
- Detailed analytics, feedback, ratings, and gamification.
- Final privacy policy, terms, retention, and commercial licensing terms.

## 14. Non-goals
- No cancellation/refund workflow under current product direction.
- No tenant self-creation or tenant resale in the initial business model.
- No promise of live GPS/ETA without an implemented and validated integration.
- No public exposure of private passenger or account information.
