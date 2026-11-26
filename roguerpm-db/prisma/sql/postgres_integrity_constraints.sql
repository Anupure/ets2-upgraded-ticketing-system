-- Apply after the Prisma-generated initial migration, or incorporate these
-- statements into the initial migration before deploying to production.
-- Prisma cannot express partial unique indexes, exclusion constraints,
-- cross-table segment validation, or all business invariants in schema.prisma.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Only one operational journey may exist at a time.
CREATE UNIQUE INDEX journeys_one_operational_journey
ON journeys ((true))
WHERE status IN ('BOOKING_OPEN', 'BOARDING', 'IN_PROGRESS', 'PAUSED');

-- MVP policy: one non-terminal ticket per passenger per journey.
CREATE UNIQUE INDEX tickets_one_active_per_user_per_journey
ON tickets (journey_id, user_id)
WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'BOARDED');

-- Prevent overlapping allocations for the same seat on the same journey.
-- Half-open ranges [from, to) allow a seat to be reused at the exact stop
-- where the previous passenger disembarks.
ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_valid_segment
CHECK (from_sequence >= 1 AND to_sequence > from_sequence);

ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_no_overlap
EXCLUDE USING gist (
  journey_id WITH =,
  seat_id WITH =,
  int4range(from_sequence, to_sequence, '[)') WITH &&
)
WHERE (status IN ('HELD', 'CONFIRMED', 'OCCUPIED'));

-- A held seat must have an expiry; confirmed/occupied reservations do not.
ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_held_expiry
CHECK (status <> 'HELD' OR reserved_until IS NOT NULL);

-- Basic non-negative/configuration checks.
ALTER TABLE wallets
ADD CONSTRAINT wallets_balance_nonnegative CHECK (balance >= 0);

ALTER TABLE journeys
ADD CONSTRAINT journeys_positive_capacity_settings CHECK (
  break_interval_minutes > 0 AND
  personal_break_limit >= 0 AND
  personal_break_seconds > 0 AND
  grace_period_seconds >= 0 AND
  ticket_price >= 0
);

ALTER TABLE bus_layouts
ADD CONSTRAINT bus_layouts_capacity_positive CHECK (capacity > 0);

ALTER TABLE bus_seats
ADD CONSTRAINT bus_seats_coordinates_positive CHECK (
  row_number > 0 AND column_number > 0
);

ALTER TABLE tickets
ADD CONSTRAINT tickets_price_nonnegative CHECK (price_paid >= 0);

ALTER TABLE break_credit_transactions
ADD CONSTRAINT break_credit_transactions_nonzero CHECK (amount <> 0);

-- Validate that ticket origin/destination belong to the same journey and
-- that origin sequence is strictly before destination sequence.
CREATE OR REPLACE FUNCTION validate_ticket_segment()
RETURNS trigger AS $$
DECLARE
  origin_journey uuid;
  destination_journey uuid;
  origin_sequence integer;
  destination_sequence integer;
BEGIN
  SELECT journey_id, sequence
    INTO origin_journey, origin_sequence
    FROM journey_stops WHERE id = NEW.origin_stop_id;

  SELECT journey_id, sequence
    INTO destination_journey, destination_sequence
    FROM journey_stops WHERE id = NEW.destination_stop_id;

  IF origin_journey IS NULL OR destination_journey IS NULL THEN
    RAISE EXCEPTION 'Ticket origin and destination must reference existing journey stops';
  END IF;

  IF origin_journey <> NEW.journey_id OR destination_journey <> NEW.journey_id THEN
    RAISE EXCEPTION 'Ticket stops must belong to the ticket journey';
  END IF;

  IF origin_sequence >= destination_sequence THEN
    RAISE EXCEPTION 'Ticket origin must precede destination';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_validate_segment
BEFORE INSERT OR UPDATE OF journey_id, origin_stop_id, destination_stop_id
ON tickets
FOR EACH ROW EXECUTE FUNCTION validate_ticket_segment();

-- Validate that a seat belongs to the bus layout assigned to the journey,
-- and that reservation segment is inside the journey's stop range.
CREATE OR REPLACE FUNCTION validate_seat_reservation()
RETURNS trigger AS $$
DECLARE
  journey_layout uuid;
  seat_layout uuid;
  max_sequence integer;
BEGIN
  SELECT bus_layout_id INTO journey_layout
    FROM journeys WHERE id = NEW.journey_id;

  SELECT bus_layout_id INTO seat_layout
    FROM bus_seats WHERE id = NEW.seat_id;

  SELECT MAX(sequence) INTO max_sequence
    FROM journey_stops WHERE journey_id = NEW.journey_id;

  IF journey_layout IS NULL OR seat_layout IS NULL OR journey_layout <> seat_layout THEN
    RAISE EXCEPTION 'Seat must belong to the bus layout assigned to the journey';
  END IF;

  IF max_sequence IS NULL OR NEW.from_sequence < 1 OR NEW.to_sequence > max_sequence OR NEW.to_sequence <= NEW.from_sequence THEN
    RAISE EXCEPTION 'Seat reservation segment is outside the journey stop range';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = NEW.ticket_id
      AND t.journey_id = NEW.journey_id
      AND (SELECT sequence FROM journey_stops WHERE id = t.origin_stop_id) = NEW.from_sequence
      AND (SELECT sequence FROM journey_stops WHERE id = t.destination_stop_id) = NEW.to_sequence
  ) THEN
    RAISE EXCEPTION 'Seat reservation segment must match its ticket segment';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seat_reservations_validate
BEFORE INSERT OR UPDATE OF ticket_id, journey_id, seat_id, from_sequence, to_sequence
ON seat_reservations
FOR EACH ROW EXECUTE FUNCTION validate_seat_reservation();

-- One active personal break request per passenger journey.
CREATE UNIQUE INDEX break_requests_one_open_personal_break
ON break_requests (passenger_journey_id)
WHERE break_type = 'PERSONAL'
  AND passenger_journey_id IS NOT NULL
  AND status IN ('REQUESTED', 'ACCEPTED', 'BREAK_STARTED');

-- One live/pending stream session per journey.
CREATE UNIQUE INDEX stream_sessions_one_live_per_journey
ON stream_sessions (journey_id)
WHERE status IN ('SCHEDULED', 'LIVE', 'DISCONNECTED');

-- At most one passenger-requested break may be pending/active for the whole bus.
-- Mandatory breaks are controlled separately by the operator.
CREATE UNIQUE INDEX break_requests_one_open_personal_break_per_journey
ON break_requests (journey_id, (true))
WHERE break_type = 'PERSONAL'
  AND status IN ('REQUESTED', 'ACCEPTED', 'BREAK_STARTED');
