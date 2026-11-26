-- Use the weakest table lock that preserves the row-lock protocol.
-- The row-level guards below still lock affected journey rows FOR UPDATE,
-- which conflicts with booking transactions' journey row locks.
--
-- ROW SHARE is compatible with ROW EXCLUSIVE, which ordinary journey
-- INSERT/UPDATE/DELETE statements acquire. EXCLUSIVE caused deadlocks when
-- concurrent journey creation and route/seat edits each attempted to upgrade
-- their table locks.

CREATE OR REPLACE FUNCTION lock_journeys_before_bus_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN ROW SHARE MODE;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION lock_journeys_before_stop_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN ROW SHARE MODE;
  RETURN NULL;
END;
$$;
