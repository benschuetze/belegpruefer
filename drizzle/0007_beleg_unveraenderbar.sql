-- The lease column arrived in 0006, after the runtime role's grants in 0005.
GRANT UPDATE (processing_started_at) ON documents TO belegpruefer_app;
--> statement-breakpoint
-- A document is evidence like the protocol. The runtime role cannot touch file, hash or tenant at all (column
-- grants); this trigger holds the same line for the owner and adds the rules about when content may change:
-- what was read from the invoice is written once, by the run that holds the claim, and a festgeschriebener
-- document only ever goes back to "bestaetigt" (Storno), with its content unchanged.
CREATE OR REPLACE FUNCTION reject_document_change() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.content_base64 IS DISTINCT FROM OLD.content_base64 OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.filename IS DISTINCT FROM OLD.filename
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Beleg %: Datei und Herkunft sind unveränderbar', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.extracted_jsonb IS DISTINCT FROM OLD.extracted_jsonb OR NEW.findings_jsonb IS DISTINCT FROM OLD.findings_jsonb)
     AND OLD.status <> 'verarbeitung' THEN
    RAISE EXCEPTION 'Beleg %: Inhalt nur während der Verarbeitung änderbar', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'festgeschrieben' AND NEW.status NOT IN ('festgeschrieben', 'bestaetigt') THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben: nur Storno möglich', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_evidence BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION reject_document_change();
