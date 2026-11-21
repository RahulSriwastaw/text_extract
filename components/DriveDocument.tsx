import React, { useEffect, useRef, useState } from "react";
import { bankRequest } from "../services/questionBank";

type DocumentFile = {
  name: string;
  blob: Blob;
  local: string;
  drive?: string;
  id?: string;
};
export function DriveDocument({
  generate,
  name,
  disabled,
}: {
  generate: () => Promise<Blob>;
  name: string;
  disabled: boolean;
}) {
  const [file, setFile] = useState<DocumentFile>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const local = useRef(""),
    alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      URL.revokeObjectURL(local.current);
    };
  }, []);
  async function save(retry = false, replace = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let output = file;
      if (!retry) {
        const blob = await generate();
        if (!alive.current) return;
        const clean = (name.trim() || "document")
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(/\.docx$/i, "");
        URL.revokeObjectURL(local.current);
        local.current = URL.createObjectURL(blob);
        output = {
          name: clean + ".docx",
          blob,
          local: local.current,
          id: replace ? file?.id : undefined,
        };
        setFile(output);
      }
      if (!output) return;
      const { uploadUrl } = await bankRequest("document", {
        name: output.name,
        previousId: output.id,
      });
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: output.blob,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      });
      if (!response.ok)
        throw Error("Drive upload failed. Download your file or retry.");
      const data = await response.json();
      if (alive.current)
        setFile({
          ...output,
          id: data.id,
          drive:
            data.webViewLink ||
            "https://drive.google.com/open?id=" + encodeURIComponent(data.id),
        });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="btn btn-secondary"
        disabled={disabled || busy}
        onClick={() => save()}
      >
        {busy
          ? "Saving…"
          : file?.drive
            ? "Save new Drive copy"
            : "Save DOCX to Drive"}
      </button>
      {file?.drive && (
        <button
          className="btn btn-secondary"
          disabled={disabled || busy}
          onClick={() => save(false, true)}
        >
          Update existing file
        </button>
      )}
      {file && (
        <>
          <span className="text-xs">{file.name}</span>
          <a
            className="btn btn-secondary btn-sm"
            download={file.name}
            href={file.local}
          >
            Download file
          </a>
        </>
      )}
      {file?.drive && (
        <>
          <a
            className="btn btn-secondary btn-sm"
            target="_blank"
            rel="noreferrer"
            href={file.drive}
          >
            Open in Drive
          </a>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              navigator.clipboard
                .writeText(file.drive!)
                .catch(() => setError("Copy the link from Open in Drive."))
            }
          >
            Copy link
          </button>
        </>
      )}
      {error && (
        <span role="alert">
          {error}{" "}
          {file && !file.drive && (
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => save(true)}
            >
              Retry upload
            </button>
          )}
        </span>
      )}
    </div>
  );
}
