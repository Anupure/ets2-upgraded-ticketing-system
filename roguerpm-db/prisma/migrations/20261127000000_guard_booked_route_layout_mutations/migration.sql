-- Freeze route and coach-layout structure once a journey has ticket history.
-- This is intentionally forward-only: the initial migration is already deployed.

CREATE OR REPLACE FUNCTION guard_journey_stop_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_journey_ids uuid[];
  affected_journey_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_journey_ids := ARRAY[NEW.journey_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected_journey_ids := ARRAY[OLD.journey_id];
  ELSE
    affected_journey_ids := ARRAY[OLD.journey_id, NEW.journey_id];
  END IF;

  -- Serialize route edits with booking transactions, which lock the journey row.
  FOR affected_journey_id IN
    SELECT DISTINCT id
    FROM journeys
    WHERE id = ANY(affected_journey_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM tickets WHERE journey_id = affected_journey_id) THEN
      RAISE EXCEPTION 'Journey stops cannot be structurally changed after tickets exist'
        USING ERRCODE = '23514',
              CONSTRAINT = 'journey_stops_frozen_after_ticketing';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journey_stops_guard_structure
BEFORE INSERT OR DELETE OR UPDATE OF journey_id, sequence
ON journey_stops
FOR EACH ROW
EXECUTE FUNCTION guard_journey_stop_mutation();


CREATE OR REPLACE FUNCTION guard_journey_bus_layout_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bus_layout_id IS DISTINCT FROM OLD.bus_layout_id
     AND EXISTS (SELECT 1 FROM tickets WHERE journey_id = OLD.id) THEN
    RAISE EXCEPTION 'A journey bus layout cannot change after tickets exist'
      USING ERRCODE = '23514',
            CONSTRAINT = 'journey_bus_layout_frozen_after_ticketing';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journeys_guard_bus_layout
BEFORE UPDATE OF bus_layout_id
ON journeys
FOR EACH ROW
EXECUTE FUNCTION guard_journey_bus_layout_change();


CREATE OR REPLACE FUNCTION guard_bus_layout_structure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_layout_id uuid;
  affected_journey_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_layout_id := OLD.id;
  ELSE
    affected_layout_id := NEW.id;
  END IF;

  -- Lock journeys in stable order to serialize layout edits with bookings.
  FOR affected_journey_id IN
    SELECT id
    FROM journeys
    WHERE bus_layout_id = affected_layout_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM tickets WHERE journey_id = affected_journey_id) THEN
      RAISE EXCEPTION 'Bus layout structure cannot change while an assigned journey has tickets'
        USING ERRCODE = '23514',
              CONSTRAINT = 'bus_layout_structure_frozen_after_ticketing';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bus_layouts_guard_structure
BEFORE UPDATE OF capacity, layout
ON bus_layouts
FOR EACH ROW
EXECUTE FUNCTION guard_bus_layout_structure();


CREATE OR REPLACE FUNCTION guard_bus_seat_structure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_layout_ids uuid[];
  affected_layout_id uuid;
  affected_journey_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_layout_ids := ARRAY[NEW.bus_layout_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected_layout_ids := ARRAY[OLD.bus_layout_id];
  ELSE
    affected_layout_ids := ARRAY[OLD.bus_layout_id, NEW.bus_layout_id];
  END IF;

  FOR affected_layout_id IN
    SELECT DISTINCT layout_id
    FROM unnest(affected_layout_ids) AS layouts(layout_id)
    WHERE layout_id IS NOT NULL
    ORDER BY layout_id
  LOOP
    FOR affected_journey_id IN
      SELECT id
      FROM journeys
      WHERE bus_layout_id = affected_layout_id
      ORDER BY id
      FOR UPDATE
    LOOP
      IF EXISTS (SELECT 1 FROM tickets WHERE journey_id = affected_journey_id) THEN
        RAISE EXCEPTION 'Bus seats cannot be structurally changed while an assigned journey has tickets'
          USING ERRCODE = '23514',
                CONSTRAINT = 'bus_seats_frozen_after_ticketing';
      END IF;
    END LOOP;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bus_seats_guard_structure
BEFORE INSERT OR DELETE OR UPDATE OF bus_layout_id, seat_number, row_number, column_number, seat_type, is_bookable
ON bus_seats
FOR EACH ROW
EXECUTE FUNCTION guard_bus_seat_structure();
