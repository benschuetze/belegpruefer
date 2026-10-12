-- Row triggers do not fire on TRUNCATE; a statement trigger closes that gap for the protocol tables.
-- Tests reset their database with session_replication_role = replica, which skips ordinary triggers.
CREATE TRIGGER decisions_no_truncate BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER reviews_no_truncate BEFORE TRUNCATE ON reviews
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
