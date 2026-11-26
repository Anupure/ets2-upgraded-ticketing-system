-- Establish a consistent lock order for bus-seat edits versus bookings.
-- Booking transactions lock a journey before inserting a seat reservation. A
-- row-level seat trigger runs after PostgreSQL has locked the seat row, which
-- can invert that order and deadlock. Take a conflicting table lock before
-- PostgreSQL locks any individual bus_seats rows.
CREATE OR REPLACE FUNCTION lock_journeys_before_bus_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  LOCK TABLE journeys IN SHARE ROW EXCLUSIVE MODE;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bus_seats_lock_journeys_before_mutation
BEFORE INSERT OR UPDATE OR DELETE
ON bus_seats
FOR EACH STATEMENT
EXECUTE FUNCTION lock_journeys_before_bus_seat_mutation();
