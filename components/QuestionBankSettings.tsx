import React, { useEffect, useRef, useState } from "react";
import { bankRequest, type BankProfile } from "../services/questionBank";

export function QuestionBankSettings({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<BankProfile | null>(null);
  const [mode, setMode] = useState<"link" | "google">("link");
  const [provider, setProvider] = useState<"sheets" | "airtable">("sheets");
  const [folder, setFolder] = useState(""),
    [folderName, setFolderName] = useState("");
  const [sheet, setSheet] = useState(""),
    [base, setBase] = useState(""),
    [table, setTable] = useState("");
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]),
    [cursor, setCursor] = useState("");
  const [bases, setBases] = useState<{ id: string; name: string }[]>([]),
    [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [parent, setParent] = useState("root"),
    [admin, setAdmin] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    void run(async () => {
      const data = await bankRequest("profile");
      setAdmin(data.adminEmail);
      const p = data.profile;
      if (p) {
        setCurrent(p);
        setMode(p.mode);
        setProvider(p.provider);
        setFolder(p.root);
        setFolderName(p.name);
        setSheet(p.sheet);
        setBase(p.base);
        setTable(p.table);
      }
    });
    const completed = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.qbAuth)
        setStatus("Connected. Choose your folder or base below.");
    };
    window.addEventListener("message", completed);
    return () => {
      el.close();
      window.removeEventListener("message", completed);
    };
  }, []);
  function authorize(service: string) {
    const popup = window.open(
      "about:blank",
      "qb_oauth",
      "width=580,height=720",
    );
    if (!popup) {
      setStatus("Allow the sign-in popup and try again.");
      return;
    }
    void run(async () => {
      try {
        popup.location.href = (await bankRequest("oauth/" + service, {})).url;
      } catch (e) {
        popup.close();
        throw e;
      }
    });
  }
  async function browse(target: string, more = "") {
    const data = await bankRequest(
      "folders?parent=" +
        encodeURIComponent(target) +
        "&cursor=" +
        encodeURIComponent(more),
    );
    setFolders((prev) => (more ? [...prev, ...data.files] : data.files));
    setCursor(data.nextPageToken || "");
    setParent(target);
  }
  const btn = "btn btn-secondary btn-sm";
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      aria-label="My question bank"
      className="fixed inset-0 m-auto w-[min(94vw,32rem)] max-h-[88vh] overflow-auto rounded-xl border border-line bg-surface p-5 text-ink backdrop:bg-black/70"
    >
      <header className="flex justify-between items-center">
        <h2 className="font-bold">My question bank</h2>
        <button onClick={close} className={btn}>
          Close
        </button>
      </header>
      {current && (
        <p className="my-3 text-sm">
          Connected to {current.name} ·{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={"https://drive.google.com/drive/folders/" + current.root}
          >
            Open folder
          </a>{" "}
          ·{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={
              current.provider === "sheets"
                ? "https://docs.google.com/spreadsheets/d/" + current.sheet
                : "https://airtable.com/" + current.base + "/" + current.table
            }
          >
            Open questions
          </a>
        </p>
      )}
      {current && (
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await bankRequest("disable", {});
              setCurrent(null);
              window.dispatchEvent(new Event("qb-profile"));
              setStatus(
                "Personal storage turned off. Existing files are available in Drive.",
              );
            })
          }
        >
          Turn off personal storage
        </button>
      )}
      <fieldset disabled={busy} className="grid gap-3 mt-4 text-sm">
        <label>
          Drive folder{" "}
          <select
            className="input w-full"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setFolder("");
              setFolderName("");
            }}
          >
            <option value="link">Paste folder link</option>
            <option value="google">Browse my Google Drive</option>
          </select>
        </label>
        {mode === "link" ? (
          <>
            <p>
              Share your folder as Editor with{" "}
              {admin || "the Google account connected by your team admin"}.
            </p>
            <input
              className="input"
              aria-label="Drive folder link"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setFolderName("");
              }}
              placeholder="Paste your Google Drive folder link"
            />
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <button className={btn} onClick={() => authorize("google")}>
                Connect Google
              </button>
              <button className={btn} onClick={() => run(() => browse("root"))}>
                Browse folders
              </button>
            </div>
            {!!folders.length && (
              <ul className="max-h-40 overflow-auto">
                {folders.map((f) => (
                  <li
                    className="flex justify-between items-center py-1"
                    key={f.id}
                  >
                    {f.name}
                    <span>
                      <button
                        className={btn}
                        onClick={() => run(() => browse(f.id))}
                      >
                        Browse
                      </button>{" "}
                      <button
                        className={btn}
                        onClick={() => {
                          setFolder(f.id);
                          setFolderName(f.name);
                        }}
                      >
                        Select
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {cursor && (
              <button
                className={btn}
                onClick={() => run(() => browse(parent, cursor))}
              >
                More folders
              </button>
            )}
          </>
        )}
        {folder && (
          <p>{folderName || "Selected folder"} → Images / Documents</p>
        )}
        <label>
          Save questions to{" "}
          <select
            className="input w-full"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="sheets">Google Sheets</option>
            <option value="airtable">Airtable</option>
          </select>
        </label>
        {provider === "sheets" ? (
          <label>
            Existing spreadsheet (optional)
            <input
              className="input w-full"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              placeholder="Leave empty to use Questions in this folder"
            />
          </label>
        ) : (
          <>
            <div className="flex gap-2">
              <button className={btn} onClick={() => authorize("airtable")}>
                Connect Airtable
              </button>
              <button
                className={btn}
                onClick={() =>
                  run(async () => setBases((await bankRequest("bases")).bases))
                }
              >
                List bases
              </button>
            </div>
            <select
              aria-label="Airtable base"
              className="input"
              value={base}
              onChange={(e) => {
                const b = e.target.value;
                setBase(b);
                setTable("");
                setTables([]);
                if (b)
                  void run(async () =>
                    setTables((await bankRequest("tables?base=" + b)).tables),
                  );
              }}
            >
              <option value="">Choose a base</option>
              {base && !bases.some((b) => b.id === base) && (
                <option>{base}</option>
              )}
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Airtable table"
              className="input"
              value={table}
              onChange={(e) => setTable(e.target.value)}
            >
              <option value="">Create or use Questions table</option>
              {table && !tables.some((t) => t.id === table) && (
                <option>{table}</option>
              )}
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          className="btn btn-primary"
          disabled={!folder.trim() || (provider === "airtable" && !base)}
          onClick={() =>
            run(async () => {
              const { profile } = await bankRequest("profile", {
                mode,
                provider,
                folder: folder.trim(),
                base,
                table,
                sheet: sheet.trim(),
              });
              setCurrent(profile);
              setFolderName(profile.name);
              window.dispatchEvent(new Event("qb-profile"));
              setStatus(
                "Saved. Images and documents will use " + profile.name + ".",
              );
            })
          }
        >
          Confirm storage
        </button>
      </fieldset>
      <p aria-live="polite" className="mt-2 text-sm">
        {busy ? "Checking…" : status}
      </p>
    </dialog>
  );
}
