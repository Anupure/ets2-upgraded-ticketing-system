# RogueRPM Passenger System — Database Foundation

This package contains the initial Prisma data model and PostgreSQL-specific integrity migration.

## Assumptions

- Prisma 6-style schema configuration (`url` in `schema.prisma`).
- PostgreSQL is the source of truth.
- One operational journey at a time.
- One active ticket per passenger per journey for the MVP.
- Seat allocations use half-open stop ranges `[from_sequence, to_sequence)`.
- Initial token balance is 1,000 and must be granted by an idempotent user-provisioning service, not by a database default.
- Passenger check-in is self-service; sensitive state transitions are still validated server-side.

## Important migration note

`prisma/sql/postgres_integrity_constraints.sql` contains PostgreSQL-specific constraints and triggers that Prisma Schema Language cannot fully represent. It is intentionally stored outside `prisma/migrations` so Prisma does not try to apply it before the tables exist.

For a new database:

```bash
npm install
npx prisma format
npx prisma validate
npx prisma migrate dev --name init
```

Then create a second migration directory (for example, `prisma/migrations/202611260002_postgres_integrity_constraints/`), copy `prisma/sql/postgres_integrity_constraints.sql` into it as `migration.sql`, and run:

```bash
npx prisma migrate dev
npx prisma generate
```

For deployment, commit both migration directories and run:

```bash
npx prisma migrate deploy
```

Do not run the integrity SQL manually against a production database after Prisma has recorded a migration containing the same statements; that would attempt to create duplicate constraints.

## Environment

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/roguerpm?schema=public"
```

## Important implementation rules

1. Buy tickets and debit tokens in one database transaction.
2. Lock or atomically update the wallet row and use a unique idempotency key.
3. Create the ticket, passenger-journey record and seat reservation consistently.
4. Treat seat reservation conflicts as expected domain errors; never trust a client-side availability check.
5. Store break deadlines in the database. Timers must be computed from server timestamps.
6. Publish WebSocket events only after the database transaction commits.
7. Never expose OAuth tokens, ticket secrets or private passenger information in the public OBS overlay.

## Deliberate MVP limitation

The model currently supports one ticket per passenger per journey. A passenger may travel across multiple stop segments by buying a single ticket from their chosen origin to destination. Multiple separate tickets for the same user in one journey can be added later if the product needs transfers or split bookings.

## Seed data

The seed script creates a sample 42-seat coach layout and 12 avatar records:

```bash
npx prisma db seed
```

Avatar image paths are placeholders (`/avatars/passenger-XX.svg`). Add the corresponding SVG assets to the app's `public/avatars` directory or replace the URLs with your chosen avatar assets.
