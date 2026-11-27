# Booking API integration contract

This repository is a Prisma 6 / TypeScript service package, not a Next.js application. `src/http-api.ts` now provides a framework-neutral API dispatcher that can be mounted by a future Next.js route handler or another HTTP server. It deliberately does not implement authentication itself: the host must inject a verified server-session resolver.

## Current service exports

- `provisionWallet(db, userId)` — creates the wallet and one-time welcome grant.
- `purchaseTicket(db, input)` — atomic wallet debit, ledger entry, ticket, passenger journey and segment seat reservation.
- `checkIn(db, userId, ticketId)` — passenger self-check-in.
- `confirmBoarding(db, operatorId, ticketId)` — operator-confirmed physical boarding.
- `getSeatMap(db, journeyId, fromSequence?, toSequence?)` — safe seat projection.
- `disembarkPassenger(db, operatorId, ticketId)` — complete an onboard passenger at their destination and release the seat.
- `markNoShow(db, operatorId, ticketId)` — finalize an unboarded passenger after the origin stop has departed and release the seat.
- `closeBooking(db, operatorId, journeyId)` — close ticket sales and lock the journey before departure.
- `arriveAtStop(db, operatorId, journeyId, stopId)` — mark the first or next stop arrived.
- `openBoardingAtStop(db, operatorId, journeyId, stopId)` — open check-in and operator boarding at the current stop.
- `departStop(db, operatorId, journeyId, stopId)` — close boarding and depart to the next stop.
- `completeJourneyAtFinalStop(db, operatorId, journeyId)` — complete the journey after final-stop arrival and resolution of all passenger tickets.
- `getOperatorDashboard(db, operatorId, journeyId)` — operator-only journey, bus, stop and ticket-status overview.
- `getPassengerManifest(db, operatorId, journeyId, stopId)` — operator-only stop manifest with passenger identity, ticket state and seat assignment.

## Required HTTP boundary

All endpoints must derive `userId` and roles from a verified server session. Never accept a user ID, role, wallet balance, or authoritative price from the browser.

### `GET /api/journeys/active`

Return the active public journey summary and ordered stops. Do not return staff IDs, audit records, emails, wallet data, ticket IDs or private ticket credentials.

### `GET /api/journeys/:journeyId/seats?from=:sequence&to=:sequence`

Validate both integer sequences together and delegate to `getSeatMap`. For OBS, use the current leg `[currentStopSequence, currentStopSequence + 1)`. Public identity is included only for an `OCCUPIED` reservation, i.e. after operator confirmation.

### `POST /api/journeys/:journeyId/tickets`

Body:

```json
{
  "originStopId": "uuid",
  "destinationStopId": "uuid",
  "seatNumber": "12"
}
```

Header: `Idempotency-Key: <client-generated UUID retained across retries>`.

Server flow:

1. Authenticate and derive `userId` from the session.
2. Validate the body and reject unknown fields (the current dispatcher uses explicit runtime checks; it does not use Zod).
3. Fetch the journey's `ticketPrice` from PostgreSQL.
4. Call `purchaseTicket` with that server-fetched price as `expectedPrice`.
5. Return a safe ticket summary. Never return ledger internals or private credentials.

The schema currently implements fixed journey-level pricing. Segment/distance pricing described as a possible PRD option is not implemented.

### `POST /api/tickets/:ticketId/check-in`

Authenticate, derive `userId` from the session, and call `checkIn(db, userId, ticketId)`. This is a passenger declaration, not physical boarding.

### `POST /api/operator/tickets/:ticketId/board`

Require an active `OPERATOR` or `ADMIN` session, then call `confirmBoarding(db, operatorId, ticketId)`. This transitions ticket to `BOARDED`, passenger journey to `ONBOARD`, and reservation to `OCCUPIED` in one transaction. The service also checks the role; keep the route-level check for clear HTTP 403 responses.

### `POST /api/operator/tickets/:ticketId/disembark`

Require an active `OPERATOR` or `ADMIN` session and call `disembarkPassenger`. The coach must be at the booked destination and that stop must be marked `ARRIVED` or `BOARDING_OPEN`. The transaction completes the ticket and passenger journey, releases the occupied seat, and records the disembarkation event.

### `POST /api/operator/tickets/:ticketId/no-show`

Require an active `OPERATOR` or `ADMIN` session and call `markNoShow`. The coach must have departed the booked origin (`JourneyStop.status = DEPARTED`) and still be at that stop in the journey sequence. The operation handles both `CONFIRMED` and `CHECKED_IN` tickets that were not physically boarded, releases the confirmed seat, and records a no-show event. Do not infer absence from elapsed time alone.

### `GET /api/operator/journeys/:journeyId/dashboard`

Require an active `OPERATOR` or `ADMIN` session and call `getOperatorDashboard`. Returns journey status, ordered stops, bus capacity and ticket counts by status. BigInt values are serialized as strings. Does not return email, wallet data or ticket credentials.

### `GET /api/operator/journeys/:journeyId/stops/:stopId/manifest`

Require an active `OPERATOR` or `ADMIN` session and call `getPassengerManifest`. Returns passengers whose ticket segment includes the selected stop, their display name/avatar, ticket and passenger state, and seat number when a reservation covers the stop. Do not expose private ticket credentials or account data.

### Operator journey stop controls

- `POST /api/operator/journeys/:journeyId/close-booking` calls `closeBooking`. It transitions `BOOKING_OPEN` to `PAUSED` with no current stop, which is the explicit pre-departure state; ticket purchases then fail because the journey is no longer `BOOKING_OPEN`.
- `POST /api/operator/journeys/:journeyId/stops/:stopId/arrive` calls `arriveAtStop`. The first arrival is allowed only from the booking-closed pre-departure state; subsequent arrivals must be the next stop after departure.
- `POST /api/operator/journeys/:journeyId/stops/:stopId/open-boarding` calls `openBoardingAtStop`. This opens passenger check-in and physical boarding for the current arrived stop.
- `POST /api/operator/journeys/:journeyId/stops/:stopId/depart` calls `departStop`. This closes the boarding window and moves the journey to `IN_PROGRESS` for the next stop.
- `POST /api/operator/journeys/:journeyId/complete` calls `completeJourneyAtFinalStop` after the final stop has been marked arrived and all tickets have been completed, marked no-show, or otherwise moved to a terminal state. The final destination does not need a boarding window or a departure action.

Every operation requires an active `OPERATOR` or `ADMIN` session, locks the journey row, and records a journey event. Passenger check-in and operator-confirmed boarding also acquire the same journey row lock, serializing them against stop departure and preventing a passenger from boarding concurrently with departure. The server must derive `operatorId` from the authenticated session.

### `GET /api/me/wallet`

Return `balance` as a decimal string because Prisma `BigInt` cannot be serialized directly to JSON. Do not serialize the raw Prisma Wallet object.

## Important constraints and remaining work

- The PostgreSQL exclusion constraint `seat_reservations_no_overlap` is required for concurrent segment allocation.
- The partial unique index currently permits one active ticket per passenger per journey. That is an MVP rule, not an unavoidable product rule.
- Operator boarding, destination disembarkation, no-show finalization, seat release, stop arrival/boarding/departure controls and final journey completion are implemented as transactional services. Operator dashboard overview and stop-wise manifest read services are implemented. The HTTP dispatcher is implemented but not yet mounted; frontend and realtime delivery are still not implemented.
- The API dispatcher is implemented, but it is not yet mounted on a listening HTTP server or Next.js route handlers. Auth.js configuration, Next.js UI and realtime transport are still not present. The host adapter must parse the incoming JSON body, pass method/URL/headers/body to `createApiHandler`, serialize its `{ status, body }` response, and supply a trusted `getSession` implementation.
- `createApiHandler({ db, getSession })` is exported from `src/index.ts`. `getSession` must return `{ userId }` from a verified session or `null`; never trust an ID from request input. Operator service methods independently validate the active operator/admin role in PostgreSQL.
- Publish realtime events only after a transaction commits. Prefer a transactional outbox before introducing Socket.IO broadcasts.
- Retry PostgreSQL serialization failures (SQLSTATE `40001`) with a small bounded retry while preserving the same idempotency key.

## Manual verification cases

1. Welcome credit under concurrent first-login calls is issued once.
2. Reusing the same idempotency key and same payload returns the same ticket; changing the payload yields an idempotency conflict.
3. Concurrent overlapping seat purchases: exactly one commits and only one wallet is debited.
4. Adjacent segments `[1,2)` and `[2,4)` can reuse one seat.
5. Insufficient balance creates no ticket, ledger entry or seat reservation.
6. Check-in is allowed only during `BOARDING`, at ticket origin, for the authenticated owner.
7. Check-in retries do not create duplicate check-in events.
8. Only an active operator/admin can confirm boarding.
9. Boarding atomically changes ticket, passenger and seat reservation states.
10. Public seat-map payload contains no email, ticket ID, wallet balance, YouTube identity or private credentials.
11. A ticket that is only `CONFIRMED` or `CHECKED_IN` is not shown as physically occupying a seat.
12. Disembarkation is accepted only at the booked destination when the stop is `ARRIVED` or `BOARDING_OPEN`; ticket, passenger and seat state change atomically.
13. No-show is accepted only after the booked origin is `DEPARTED`; both `CONFIRMED` and `CHECKED_IN` unboarded tickets are handled.
14. Repeating either lifecycle action returns the terminal state without creating duplicate events.
15. A released seat can be booked for a later non-overlapping route segment.
