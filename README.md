# ETS2 Live Coach Ticketing System

A mobile-first Next.js application backed by the existing TypeScript/Prisma booking services and PostgreSQL database.

## Stack

- Next.js App Router and React
- TypeScript
- Auth.js (Google OAuth, JWT sessions)
- Prisma 6 and PostgreSQL
- Existing transactional booking, seat allocation and operator lifecycle services

## Local setup

Requirements: Node.js 20.9+ and the existing Neon/PostgreSQL database.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set the database and Google OAuth values. Do not commit `.env.local`.

3. In Google Cloud Console, configure an OAuth web client and add this authorized redirect URI:

   ```
   http://localhost:3000/api/auth/callback/google
   ```

4. Generate an Auth.js secret:

   ```bash
   openssl rand -base64 32
   ```

5. Generate Prisma Client and start the app:

   ```bash
   npm run db:generate
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000).

For production, configure the matching production Google OAuth callback URL and set `AUTH_URL` / `AUTH_SECRET` and the database variables in the hosting provider's encrypted environment settings.

## Current web functionality

- Public home page showing the active journey and ordered stops.
- Google sign-in. New verified Google accounts are provisioned as passengers and receive the existing one-time 1,000-token welcome wallet grant.
- Existing users retain their database role; suspended/deleted users cannot sign in.
- Journey detail page with route-segment selection, responsive seat map and ticket purchase.
- Operator-only journey listing.
- API dispatcher mounted under `/api/*`, with identity derived from the verified Auth.js session.
- Responsive layouts designed for narrow mobile screens and desktop.

## Important boundaries

- Google OAuth credentials and `AUTH_SECRET` are required; there is no insecure demo login.
- The current web UI is an initial application foundation. Full operator journey creation, manifests, boarding controls, break management, realtime updates and OBS overlay are still follow-on work.
- The booking service remains authoritative for pricing, wallet debits, seat conflicts, idempotency and operator permissions.
- The browser never supplies a user ID, role, wallet balance or authoritative ticket price.
- Do not run migrations against production until the target database branch and migration plan are explicitly confirmed.

## Validation

```bash
npm run typecheck
npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1
npm run build
```
