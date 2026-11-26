-- Serialize structural route/seat edits before PostgreSQL takes row locks on edited child rows.
-- Booking transactions lock a journey first, then insert tickets/reservations whose
-- foreign keys reference journey_stops and bus_seats. Row-level guards alone would
-- invert that lock order for key-changing edits.
--
-- EXCLUSIVE conflicts with the ROW SHARE table lock acquired by SELECT ... FOR UPDATE.
-- Structural edits are rare administrative operations, so this deliberately favors
-- booking correctness over concurrent unrelated bookings.
CREATE OR REPLACE FUNCTION lock_journeys_before_bus_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN EXCLUSIVE MODE;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bus_seats_lock_journeys_before_mutation
BEFORE INSERT OR DELETE OR UPDATE OF bus_layout_id, seat_number, row_number, column_number, seat_type, is_bookable
ON bus_seats
FOR EACH STATEMENT
EXECUTE FUNCTION lock_journeys_before_bus_seat_mutation();

CREATE OR REPLACE FUNCTION lock_journeys_before_stop_mutation()
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
