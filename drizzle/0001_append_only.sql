-- The protocol is evidence: once written, a decision or review never changes. The app never tries; this makes
-- the database refuse it too, so a bug or a hand-written query cannot rewrite history.
CREATE OR REPLACE FUNCTION reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% ist nur anhängend: % abgelehnt', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER reviews_append_only BEFORE UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
-- A locked (festgeschrieben) booking is final; a correction is a reversal plus a new booking (GoBD).
CREATE OR REPLACE FUNCTION reject_locked_booking_change() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Buchung % ist festgeschrieben: % abgelehnt', OLD.id, TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bookings_locked_final BEFORE UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION reject_locked_booking_change();
