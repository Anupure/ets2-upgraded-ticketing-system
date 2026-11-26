# ETS2 ticketing integration patch

This package contains the updated booking service and API contract for `Anupure/ets2-upgraded-ticketing-system`.

## Files

- `src/booking-service.ts`: adds operator-confirmed boarding and hardens seat-map projection so reserved passengers are not shown as physically aboard.
- `src/errors.ts`: adds the explicit `BOARDING_NOT_ALLOWED` domain error.
- `docs/booking-api-contract.md`: documents the API boundary and the required server-side trust rules.

## Apply

Copy `src/booking-service.ts` and `src/errors.ts` over the matching files in the repository and copy `docs/booking-api-contract.md` into its `docs/` directory.

No database schema migration is required for these changes; they use existing Prisma 6 models and enums. Existing `src/index.ts` exports all service functions through `export * from "./booking-service.js"`.

## Verification

Run from the repository root after dependencies are installed and the Prisma client is generated:

```bash
npx prisma generate --schema roguerpm-db/prisma/schema.prisma
npx tsc --noEmit
```

Then run integration tests against PostgreSQL, especially the overlapping and adjacent-segment seat allocation cases. This patch has not been compiled or exercised against a live PostgreSQL database in this environment.
