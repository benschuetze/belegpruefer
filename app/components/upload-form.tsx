import { Form, useNavigation } from "react-router";

export function UploadForm({ disabled }: { disabled: boolean }) {
  const busy = useNavigation().formAction === "/belege";
  return (
    <Form method="post" action="/belege" encType="multipart/form-data" className="ink-card flex flex-col gap-3">
      <label htmlFor="files" className="font-semibold">
        Rechnungen hochladen
      </label>
      <p className="text-[13px] text-muted-ink">
        XRechnung oder ZUGFeRD als XML, oder PDF. Mehrere Dateien auf einmal gehen.
      </p>
      <input
        id="files"
        name="files"
        type="file"
        multiple
        accept=".xml,.pdf,application/xml,text/xml,application/pdf"
        required
        disabled={disabled}
      />
      <div>
        <button type="submit" className="btn" disabled={disabled || busy}>
          {busy ? "Wird geprüft …" : "Hochladen und prüfen"}
        </button>
      </div>
      {disabled ? <p className="text-[13px] text-muted-ink">In der Demo abgeschaltet.</p> : null}
    </Form>
  );
}
