import type { Express } from "express";
import { requireUser } from "./auth.js";
import { drive, driveToken } from "./driveFigures.js";
import { saveQuestions } from "./questionSheet.js";
import {
  personalToken,
  readPrivate,
  registerPersonalOAuth,
  writePrivate,
} from "./qbOAuth.js";
import { MOCKTEST_CSV_HEADERS } from "../services/mcqColumns.js";

type Profile = {
  mode: "link" | "google";
  root: string;
  name: string;
  images: string;
  documents: string;
  sheet: string;
  provider: "sheets" | "airtable";
  base: string;
  table: string;
};
const folderMime = "application/vnd.google-apps.folder";
const sheetMime = "application/vnd.google-apps.spreadsheet";
const wordMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const jsonHeaders = { "Content-Type": "application/json" };
export const profileFor = (uid: string) => readPrivate<Profile>(uid, "profile");
const tokenFor = (uid: string, mode: Profile["mode"]) =>
  mode === "link" ? driveToken() : personalToken(uid, "google");
export async function personalImages(uid: string) {
  const p = await profileFor(uid);
  if (!p) return undefined;
  return { id: p.images, token: await tokenFor(uid, p.mode) };
}
function id(value: unknown) {
  if (typeof value !== "string" || !/^[\w-]+$/.test(value))
    throw Error("Invalid file or table ID.");
  return value;
}
function googleId(value: string, kind: "folder" | "sheet") {
  if (/^[\w-]+$/.test(value)) return id(value);
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== (kind === "folder" ? "drive.google.com" : "docs.google.com")
  )
    throw Error("Enter a Google " + kind + " link.");
  return id(
    u.pathname.match(
      kind === "folder" ? /\/folders\/([\w-]+)/ : /\/spreadsheets\/d\/([\w-]+)/,
    )?.[1],
  );
}
async function file(token: string, fileId: string) {
  return (
    await drive(
      token,
      "drive/v3/files/" +
        id(fileId) +
        "?supportsAllDrives=true&fields=id,name,parents,trashed,mimeType,owners(emailAddress),capabilities(canAddChildren,canEdit)",
    )
  ).json();
}
async function child(
  token: string,
  parent: string,
  name: string,
  mimeType: string,
) {
  const params = new URLSearchParams({
    q:
      "'" +
      id(parent) +
      "' in parents and trashed=false and name='" +
      name +
      "' and mimeType='" +
      mimeType +
      "'",
    fields: "files(id,name)",
    pageSize: "2",
  });
  const found = await (await drive(token, "drive/v3/files?" + params)).json();
  if (found.files.length > 1)
    throw Error(
      "Multiple entries named " +
        name +
        " in this folder. Choose an unambiguous folder.",
    );
  if (found.files.length) return found.files[0].id as string;
  return (
    await (
      await drive(token, "drive/v3/files?supportsAllDrives=true&fields=id", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name, mimeType, parents: [parent] }),
      })
    ).json()
  ).id as string;
}
async function air(token: string, path: string, options: RequestInit = {}) {
  const r = await fetch("https://api.airtable.com/v0/" + path, {
    ...options,
    headers: { ...jsonHeaders, Authorization: "Bearer " + token },
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.error?.message || "Airtable request failed (" + r.status + ").",
    );
  return data;
}
const airFields = ["storage_id", ...MOCKTEST_CSV_HEADERS];
async function airtableTarget(uid: string, base: string, table: string) {
  const token = await personalToken(uid, "airtable");
  const path = "meta/bases/" + id(base) + "/tables";
  const schema = await air(token, path);
  const t = table
    ? schema.tables.find((x: any) => x.id === table)
    : schema.tables.find((x: any) => x.name === "Questions");
  if (table && !t) throw Error("Choose an accessible table.");
  if (t) {
    if (
      !airFields.every((n) =>
        t.fields.some(
          (f: any) =>
            f.name === n &&
            ["multilineText", "singleLineText"].includes(f.type),
        ),
      )
    )
      throw Error(
        "Choose an empty base or a question table with matching text columns.",
      );
    return t.id;
  }
  return (
    await air(token, path, {
      method: "POST",
      body: JSON.stringify({
        name: "Questions",
        fields: airFields.map((name) => ({
          name,
          type: name === "storage_id" ? "singleLineText" : "multilineText",
        })),
      }),
    })
  ).id;
}
export function registerQuestionBank(app: Express) {
  registerPersonalOAuth(app);
  app.use("/api/qb", requireUser, (req, res, next) =>
    res.locals.user.uid === "anonymous"
      ? res.status(401).json({ error: "Sign in first." })
      : next(),
  );
  const route = (
    method: "get" | "post",
    path: string,
    fn: (uid: string, req: any, user: any) => Promise<any>,
  ) =>
    app[method]("/api/qb/" + path, async (req, res) => {
      try {
        res.json(await fn(res.locals.user.uid, req, res.locals.user));
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });
  route("get", "profile", async (uid) => ({
    profile: await profileFor(uid),
    adminEmail: process.env.QB_DRIVE_EDITOR_EMAIL || "",
  }));
  route("get", "folders", async (uid, req) => {
    const parent = id(req.query.parent || "root");
    const params = new URLSearchParams({
      q:
        "'" +
        parent +
        "' in parents and trashed=false and mimeType='" +
        folderMime +
        "'",
      fields: "nextPageToken,files(id,name)",
      orderBy: "name",
      pageSize: "100",
    });
    if (req.query.cursor) params.set("pageToken", String(req.query.cursor));
    return (
      await drive(
        await personalToken(uid, "google"),
        "drive/v3/files?" + params,
      )
    ).json();
  });
  route("get", "bases", async (uid) => {
    const token = await personalToken(uid, "airtable"),
      bases = [];
    let offset = "";
    do {
      const result = await air(
        token,
        "meta/bases" + (offset ? "?offset=" + encodeURIComponent(offset) : ""),
      );
      bases.push(...result.bases);
      offset = result.offset;
    } while (offset);
    return { bases };
  });
  route("get", "tables", async (uid, req) =>
    air(
      await personalToken(uid, "airtable"),
      "meta/bases/" + id(req.query.base) + "/tables",
    ),
  );
  route("post", "profile", async (uid, req, user) => {
    const {
      mode,
      folder,
      provider,
      base = "",
      table = "",
      sheet = "",
    } = req.body;
    if (
      !["link", "google"].includes(mode) ||
      !["sheets", "airtable"].includes(provider)
    )
      throw Error("Choose a folder and question destination.");
    const token = await tokenFor(uid, mode),
      root = googleId(folder, "folder");
    const f = await file(token, root);
    function verifyOwner(meta: any) {
      if (
        mode === "link" &&
        !(
          user.email_verified &&
          meta.owners?.some(
            (o: any) =>
              o.emailAddress?.toLowerCase() === user.email.toLowerCase(),
          )
        )
      )
        throw Error(
          "For a pasted link, use a folder and sheet owned by your verified sign-in email. For another account use Connect Google.",
        );
    }
    verifyOwner(f);
    if (
      f.trashed ||
      f.mimeType !== folderMime ||
      !f.capabilities?.canAddChildren
    )
      throw Error("This folder requires Editor access.");
    let sheetId = "",
      tableId = "";
    if (provider === "sheets" && sheet) {
      sheetId = googleId(sheet, "sheet");
      const s = await file(token, sheetId);
      verifyOwner(s);
      if (s.trashed || s.mimeType !== sheetMime || !s.capabilities?.canEdit)
        throw Error("Choose an editable Google Sheet.");
    }
    if (provider === "airtable")
      tableId = await airtableTarget(uid, id(base), table);
    if (provider === "sheets" && !sheetId)
      sheetId = await child(token, root, "Questions", sheetMime);
    const p: Profile = {
      mode,
      root,
      name: f.name,
      images: await child(token, root, "Images", folderMime),
      documents: await child(token, root, "Documents", folderMime),
      sheet: sheetId,
      provider,
      base,
      table: tableId,
    };
    await writePrivate(uid, "profile", p);
    return { profile: p };
  });
  route("post", "disable", async (uid) => {
    await writePrivate(uid, "profile", null);
    return { disabled: true };
  });
  route("post", "questions", async (uid, req) => {
    const p = await profileFor(uid);
    if (!p) throw Error("Set up your question bank first.");
    const { questions, setName } = req.body;
    if (
      !Array.isArray(questions) ||
      !questions.length ||
      questions.some((q) => typeof q?.id !== "string" || !q.id)
    )
      throw Error("Select questions with valid IDs.");
    let warning = false;
    if (p.provider === "sheets") {
      const result = await saveQuestions(uid, questions, setName, {
        id: p.sheet,
        token: await tokenFor(uid, p.mode),
      });
      warning = result.warning;
    } else {
      const token = await personalToken(uid, "airtable");
      for (let i = 0; i < questions.length; i += 10) {
        const records = questions
          .slice(i, i + 10)
          .map((q) => ({
            fields: {
              ...Object.fromEntries(
                MOCKTEST_CSV_HEADERS.map((k) => [k, String(q[k] ?? "")]),
              ),
              set_name: setName || q.set_name || "",
              storage_id: JSON.stringify([uid, q.id]),
            },
          }));
        await air(token, id(p.base) + "/" + id(p.table), {
          method: "PATCH",
          body: JSON.stringify({
            performUpsert: { fieldsToMergeOn: ["storage_id"] },
            records,
          }),
        });
        if (i + 10 < questions.length)
          await new Promise((r) => setTimeout(r, 250));
      }
    }
    let masterError = "";
    try {
      const master = await saveQuestions(uid, questions, setName);
      warning ||= master.warning;
    } catch (e) {
      masterError = (e as Error).message;
    }
    return { saved: questions.length, warning, masterError };
  });
  route("post", "document", async (uid, req) => {
    const p = await profileFor(uid);
    if (!p) throw Error("Connect a document folder first.");
    const token = await tokenFor(uid, p.mode);
    const { name, previousId } = req.body;
    if (typeof name !== "string" || !name.trim())
      throw Error("Document name required.");
    if (previousId) {
      const old = await file(token, id(previousId));
      if (
        old.trashed ||
        old.mimeType !== wordMime ||
        !old.parents?.includes(p.documents)
      )
        throw Error("Previous file is outside this Documents folder.");
    }
    const meta = {
      name: name.slice(0, 200),
      mimeType: wordMime,
      ...(previousId ? {} : { parents: [p.documents] }),
    };
    const session = await drive(
      token,
      "upload/drive/v3/files" +
        (previousId ? "/" + id(previousId) : "") +
        "?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink",
      {
        method: previousId ? "PATCH" : "POST",
        headers: {
          ...jsonHeaders,
          "X-Upload-Content-Type": wordMime,
          ...(req.get("origin") ? { Origin: req.get("origin") } : {}),
        },
        body: JSON.stringify(meta),
      },
    );
    return { uploadUrl: session.headers.get("location") };
  });
}
