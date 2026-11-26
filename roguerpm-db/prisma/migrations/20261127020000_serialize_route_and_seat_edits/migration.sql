-- Serialize structural route/seat edits before PostgreSQL takes row locks on the
-- edited child rows. Booking flows take a FOR UPDATE lock on journeys first,
-- then insert tickets/reservations whose foreign keys reference journey_stops
-- and bus_seats. A row trigger that locks journeys after the child row lock
-- would invert that order for key-changing edits (e.g. stop sequence/seat number).
--
-- EXCLUSIVE conflicts with the ROW SHARE table lock acquired by SELECT ... FOR
-- UPDATE, unlike SHARE ROW EXCLUSIVE. This is intentionally coarse-grained:
-- structural edits are rare administrative operations, while booking correctness
-- takes priority over concurrent edits to unrelated journeys.
CREATE OR REPLACE FUNCTION lock_journeys_before_bus_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN EXCLUSIVE MODE;
  RETURN NULL;
END;
$$;

CREATE FUNCTION lock_journeys_before_stop_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN EXCLUSIVE MODE;
  RETURN NULL;
END;
$$;

CREATE TRIGGER journey_stops_lock_journeys_before_mutation
BEFORE INSERT OR DELETE OR UPDATE OF journey_id, sequence
ON journey_stops
FOR EACH STATEMENT
EXECUTE FUNCTION lock_journeys_before_stop_mutation();
