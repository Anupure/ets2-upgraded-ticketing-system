# RogueRPM booking service (Prisma 6 / PostgreSQL)

This module implements the first passenger transaction path against the database foundation schema:

1. `provisionWallet()` creates one wallet and one 1,000-token welcome ledger entry.
2. `purchaseTicket()` checks journey/stops/user/price, debits tokens, writes the ledger entry, ticket, passenger journey and segment seat reservation in one serializable transaction.
3. `checkIn()` lets the ticket owner self-check-in only while the journey is in `BOARDING` at the ticket's origin stop. It deliberately does **not** mark the passenger physically aboard; the operator's boarding action does that later.
4. `getSeatMap()` returns seat availability and minimal display identity for the site/OBS overlay. It never returns ticket IDs, codes, email, YouTube identity or wallet data.

## Integration

Copy `src/` into your Next.js project (for example `src/server/booking/`). Install `@prisma/client` matching the version used by your database package and pass your shared Prisma client to the functions. Do not create a second Prisma client per request.

```ts
const result = await purchaseTicket(prisma, {
  userId: session.user.id,
  journeyId,
  originStopId,
  destinationStopId,
  seatNumber,
  idempotencyKey: request.headers.get("Idempotency-Key")!,
  expectedPrice: BigInt(priceShownByServer),
});
```

The price must be fetched/displayed from the server; `expectedPrice` is only a stale-price guard, not a trusted price. Never accept a price amount from the browser as the source of truth. The idempotency key must remain the same when retrying the same user action and must be scoped to the authenticated user at the API boundary.

## Required database setup

Apply the initial Prisma migration, then apply `prisma/sql/postgres_integrity_constraints.sql` from the database foundation package. The PostgreSQL `seat_reservations_no_overlap` exclusion constraint is required for safe concurrent segment booking. Do not deploy this service without it.

## Important implementation notes

- `purchaseTicket()` locks the journey row to serialize purchases against operator state/price changes. It uses an atomic `UPDATE ... WHERE balance >= price` to prevent negative balances.
- The seat exclusion constraint is the concurrency authority. If two requests race for overlapping segments, one transaction rolls back in full, including the wallet debit.
- Seat reservations use half-open ranges `[originSequence, destinationSequence)`, so a seat can be sold again from the exact stop where the prior passenger gets off.
- The MVP schema has a partial unique index allowing only one active ticket per user per journey. This matches the current product rule; change the index and service rule before allowing multiple segment tickets per person.
- Check-in and boarding are separate states. Check-in is a passenger declaration; operator confirmation must create the `BOARDED` transition.
- OBS/browser-source payloads should be built from `getSeatMap()` or a stricter projection, not by serializing Prisma records.
- Do not put boarding secrets in overlay payloads, URLs, browser logs or public chat.

## Verification

The code is written for the Prisma 6 model names/fields in the database foundation. This environment did not run a live PostgreSQL integration test, so validate with your exact schema and database before production. Recommended next checks: `npx prisma validate`, `npx tsc --noEmit`, then integration tests against PostgreSQL with two concurrent purchases for the same seat/overlapping segment and a second test for adjacent non-overlapping segments.
