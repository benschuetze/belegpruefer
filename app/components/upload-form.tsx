import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { MAX_FILES, MAX_REQUEST_BYTES } from "~/lib/upload-limits";

function tooMuch(files: FileList | null): string | null {
  if (!files) return null;
  if (files.length > MAX_FILES) return `Höchstens ${MAX_FILES} Dateien auf einmal.`;
  const total = Array.from(files).reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_REQUEST_BYTES) return "Zusammen mehr als 4 MB. Bitte in mehreren Schritten hochladen.";
  return null;
}

export function UploadForm({ disabled }: { disabled: boolean }) {
  const busy = useNavigation().formAction === "/belege";
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Form method="post" action="/belege" encType="multipart/form-data" className="ink-card flex flex-col gap-3">
      <label htmlFor="files" className="font-semibold">
        Rechnungen hochladen
      </label>
      <p id="files-hint" className="text-[13px] text-muted-ink">
        XRechnung oder ZUGFeRD als XML, oder PDF. Bis zu {MAX_FILES} Dateien und zusammen 4 MB auf einmal.
      </p>
      <input
        id="files"
        name="files"
        type="file"
        multiple
        accept=".xml,.pdf,application/xml,text/xml,application/pdf"
        required
        disabled={disabled}
        aria-describedby={problem ? "files-hint files-problem" : "files-hint"}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => setProblem(tooMuch(e.currentTarget.files))}
      />
      {problem ? (
        <p id="files-problem" className="text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn" disabled={disabled || busy || problem !== null}>
          {busy ? "Wird hochgeladen …" : "Hochladen und prüfen"}
        </button>
      </div>
      {disabled ? <p className="text-[13px] text-muted-ink">In der Demo abgeschaltet.</p> : null}
    </Form>
  );
}
