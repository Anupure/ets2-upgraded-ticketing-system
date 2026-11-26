-- Structural route/seat edits take an exclusive transaction-scoped advisory lock.
-- Booking and journey-state transactions take the matching shared lock BEFORE
-- locking a journey row. Shared locks preserve concurrency between bookings;
-- an exclusive structural edit waits before it can lock child rows, avoiding
-- the child-row -> journey-row / journey-row -> child-row deadlock cycle.
--
-- Unlike a table-level EXCLUSIVE lock, advisory locks do not conflict with
-- ordinary INSERT/UPDATE/DELETE table locks during concurrent journey creation.

CREATE OR REPLACE FUNCTION acquire_journey_mutation_shared_lock()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(742, 20261127);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION lock_journeys_before_bus_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(742, 20261127);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION lock_journeys_before_stop_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(742, 20261127);
  RETURN NULL;
END;
$$;
